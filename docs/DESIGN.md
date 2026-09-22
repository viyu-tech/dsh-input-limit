# dsh-input-limit 设计文档

> 版本 0.1.1 · 适配 DeepSeek Harness `dsh` **0.1.5-rc.2**
> 读者：插件维护者与贡献者。安装使用见根目录 [README](../README.md)，发布流程见 [RELEASING](RELEASING.md)。

---

## 1. 概述

`dsh-input-limit` 是一个 **浏览器端（browser-only）** 的 DeepSeek Harness 社区插件：在 Web UI
消息输入框的工具行（模型选择器旁）挂一个小胶囊（chip），显示当前会话模型的**输入上限
（上下文窗口，context window）**，点击即可在弹窗中**就地修改**并持久化为「按模型覆盖」的设置项，
无需进入 Settings 页面翻找。

它驱动的数值用于 Host 侧的**上下文占用计算与自动压缩判断**——当模型真实输入上限小于适配器
默认值（如 128K vs pi-ai 默认 262144）时，占用显示与压缩时机才能正确。

设计原则：

- **纯客户端插件**：无自定义 Host 代码；读写都走 rc.2 客户端已有 wire face
  （`ctx.remote` Typert 命名空间 + `ctx.sessions` 对象层），与 Settings 页面使用完全相同的 RPC。
- **单单位原则**：输入框只说一种单位——精确 token 数；K/M 只是显示拼写。存储值与输入值
  对「数量级」永不产生分歧。
- **可热更新**：设置文档变更（`settings/document-updated`）与本会话模型切换
  （`modelSelection` projection）都会实时刷新已打开的胶囊。

## 2. 目标与非目标

**目标**

1. 展示当前模型的有效输入上限（覆盖值或 provider 默认值），`· 默认` 标签区分来源。
2. 弹窗内输入精确 token 数（接受千分位逗号），实时换算 K/M，保存 / 恢复默认。
3. 持久化为 provider 设置段里的 per-model `contextWindow` 覆盖，行为与内置设置编辑器一致。
4. 写入冲突（`settings/conflict`）自动以新 revision 重试一次，两个编辑器互不静默覆盖。
5. 仅对「可配置 provider + 有模型选择」的会话可见；子代理（subagent）会话隐藏。

**非目标**

- 不修改 Host 侧压缩策略本身（只提供它读取的数值）。
- 不做单位输入（`128K` 式输入永远拒绝——见 §6.5）。
- 不支持非 Web 面（headless / sdk / acp profile 无 UI seat）。

## 3. 运行环境与依赖契约

| 依赖 | 契约 |
|---|---|
| `dsh` 0.1.5-rc.2 | profile/bundle 组合机制；`dsh plugin` = pnpm 转发 + `dsh.bundle` 声明自动入层 |
| Cordis 4.x | 插件以 `name` + `inject` + `apply(ctx)` 挂载；`ctx.effect` 可逆注册；traceable context proxy 要求 **dotted inject 声明** |
| `ctx.remote.settings` | `describe()`：返回 `writable` + 每命名空间的 `value/base/user` 三层视图与 `revision`；`mutate(ns, ops, expectedRevision)`：路径寻址 `set/unset`，乐观并发 |
| `ctx.remote.session` | `modelCatalog()`：Host 级模型目录，含 `default` 选择 |
| `ctx.sessions` | `binding(id).session.projections.faceOf('modelSelection')`：持久 model-selection 投影（`next`/`lastUsed`/`subscribe`）；`subagentAddress(id)` 判定子代理会话 |
| Web UI slots | `conversation.input.right` 列表 seat；locale 命名空间注册（`ctx.locale.register`） |

## 4. 包结构与双端形态

```
dsh-input-limit/
├─ package.json            # dsh.bundle.patch + dsh.client.platform: "web"
├─ cordis.patch.yml        # bundle patch：向 profile 插一行 { id, name }
├─ src/
│  ├─ index.ts             # Host 半：无行为占位入口（存在即触发 Host 服务浏览器半）
│  └─ client/
│     ├─ index.ts          # 插件主体：注册 slot、locale、刷新扇出；在 plugin fiber 内 detach faces
│     ├─ InputLimitChip.tsx# seat 组件（chip + popover，React 18）
│     ├─ contract.ts       # 注入给组件的业务面类型（available/read/write/reset/subscribe）
│     ├─ provider.ts       # 数据层：readLimit / applyModelLimit / resetModelLimit
│     ├─ capacity.ts       # 数值层：parseTokens / formatTokens / formatCompact
│     ├─ wire.ts           # rc.2 wire face 的结构类型镜像（零运行时依赖）
│     ├─ locales.ts        # zh（产品文案）/ en 双字典，en 以类型约束与 zh 键对齐
│     └─ InputLimitChip.module.css  # 自包含调色板，--ilm-* 变量供宿主主题重指向
├─ lib/                    # 预构建产物（随仓库发布，安装方免工具链）
│  ├─ index.mjs            # Host 半 ESM
│  └─ client.js(.map)      # 浏览器半：__ModuleLoader__ 闭包工厂格式
└─ tests/                  # vitest + 无依赖 verify 脚本 + bundle 冒烟
```

**挂载链**：`package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml` → `dsh plugin add` 后该包
自动加入 profile 的 bundle 层栈 → patch 向配置插入一行 `{ id: input-limit, name: dsh-input-limit }`
→ Cordis 加载 Host 入口 → Web Host 按 `dsh.client.platform: "web"` 服务
`/plugins/dsh-input-limit/client.js` → 浏览器 `window.__ModuleLoader__.load({ id, factory })`
执行浏览器半。

**浏览器 bundle 合同**（与内置 UI 插件相同，`tsdown.config.ts` 复刻）：

- 仅允许外部化平台模块（`PLATFORM_MODULES`：react / cordis / ui-slots / …），其余全部内联；
- CSS Modules 经 lightningcss 编译后内联为 `<style data-plugin>` 注入，类名带 hash 前缀；
- `import.meta.env` / `process.env.NODE_ENV` 编译期定型。

## 5. 模块职责

| 模块 | 职责 |
|---|---|
| `client/index.ts` | 注册 locale 字典；`ctx.get` 在 plugin fiber 内取出并**解耦具体 faces**（组件回调运行在 seat fiber，直接摸 `ctx.remote.x` 会触发 Cordis context proxy 的 "without inject" 错误）；建立 `settings/document-updated` → 全部监听器的刷新扇出；向 `conversation.input.right` seat 注入 per-session 的 `InputLimitInjected` |
| `client/provider.ts` | 读快照（模型→provider→models 行→contextWindow）、写覆盖、重置覆盖；RPC 失败串接为用户可见行 |
| `client/capacity.ts` | 解析/格式化：精确 tokens ↔ 千分位文本 ↔ 二进制 K/M 紧凑拼写 |
| `client/InputLimitChip.tsx` | 纯 UI 状态机：idle / ready / error；弹窗草稿、busy、错误行、预览 |
| `client/wire.ts` | wire face 的结构类型（镜像 rc.2 生成声明），使插件独立编译、零运行时依赖 |
| `client/contract.ts` | seat 注入面（业务接口），UI 与数据层的分界 |
| `client/locales.ts` | 产品文案中文为源，`en` 以 `Record<InputLimitKey, string>` 防字典漂移 |

## 6. 关键设计

### 6.1 读路径（快照）

```
modelSelection 投影 (next ?? lastUsed)     ← 会话持久选择
  └─ 空? → remote.session.modelCatalog().default
       └─ 仍空? → deadRead：seat 不渲染
选中 provider 后：
  remote.settings.describe()
  → namespaceForRoute: 找 value.providers[route] 存在的命名空间
      └─ 无? → deadRead(writable)：seat 不渲染
  → models = value[providers.<route>.models]
  → limit      = models.find(id === model)?.contextWindow   # 用户覆盖
  → defaultLimit = value/base/user 的 defaultContextWindow  # 回退链
```

快照同时携带 `namespace / modelsPath / revision`，写路径凭它寻址。

### 6.2 写路径（覆盖 + 冲突重试）

保存一次 = **最多两次**「fresh describe → 构建全量数组 `set` → `mutate(revision)`」：

1. 每次写入前重新 `describe`，从**最新视图**重建整个 `models` 数组（目标行替换或按需追加
   `{ id, model, contextWindow }`），因此两个编辑器并发时后写者不会基于陈旧数组覆盖他人改动；
2. `mutate` 返回 `settings/conflict`（文档已被他人移动）→ 用新 revision **重放一次**；重放是安全的，
   因为操作始终是「从 fresh 视图重建的全量 set」；
3. 其余错误或二次冲突即失败，错误行原文串接展示（`message (code)`）。
4. 无可构建操作（空 op 列表）直接成功，不触碰文档。

### 6.3 重置路径

仅在 **user 层** 存在该模型行时，重写 user 层 `models` 数组并**剔除 `contextWindow` 字段**
（rest-spread 丢字段），其余行原样保留。解析值随之回落到 `defaultContextWindow`（继承链），
chip 上重新出现 `· 默认` 标签。

### 6.4 刷新机制

两个信号源、一个扇出集合：

- `remote.$on('settings/document-updated')`（plugin fiber 内注册）→ 通知所有已挂载胶囊重读；
  Settings 页的修改无需重挂载即可出现；
- 会话 `modelSelection` 投影 `subscribe` → 切换模型时本胶囊重读；卸载时精确退订。

### 6.5 数值与文案规范（0.1.1 修订）

- **唯一单位**：精确 token 数。输入框预填与存储值都是精确数；K/M（二进制，1K=1024）只是
  chip 标签与输入预览的**有损拼写**（`131072` → `128K`，`262144` → `256K`）。
- **千分位逗号是 display-only 分隔符**：`formatTokens` 以 3 位分组渲染（`131,072`）。
- **解析规则（0.1.1 修订）**：`TOKENS_PATTERN = /^\d+(?:,\d+)*$/` —— 逗号可以在任意数字组之间，
  但必须在数字组**之间**（拒绝前导/尾随/双逗号）。理由：逗号永不影响数量级，弹窗重开时
  预填的是分组拼写（`20,000`），用户追加/删除数字产生的 `20,0000`、`20,00`、`13,1072` 必须
  仍然合法，否则预填值本身成了编辑陷阱（0.1.0 的严格 3 位分组正则即踩中此坑）。
- **仍拒绝**：`128K` / `1M` / `1.5` / `0` / 负数 / 夹空格 / `1e6` / 超出安全整数 / 非数字。
  单位输入永不猜测换算。

### 6.6 可见性与降级

| 场景 | 行为 |
|---|---|
| 子代理会话（`subagentAddress` 存在） | `available: false`，seat 不渲染 |
| provider 不在任何设置命名空间 | `deadRead`，不渲染 |
| 部署只读（`describe().writable === false`） | 不渲染（避免给出无法保存的入口） |
| 覆盖值与默认值都不存在 | 渲染裸标签，点击即可设置 |
| RPC 失败 / read 抛错 | `console.warn` + 错误视图；写失败时错误行展示原始 `message (code)`，不做二次猜测 |

### 6.7 Cordis 上下文代理约束（易踩坑，特此固化）

组件回调运行在 **seat 的 fiber**，此时访问 `ctx.remote.settings` 会命中 traceable context proxy
并抛 "cannot get property remote.settings without inject"。两步防御：

1. 插件 `inject` 列表显式声明 dotted 服务：`['slots','locale','remote','remote.session','remote.settings','sessions']`；
2. `apply()` 内（plugin fiber）用 `ctx.get` 取出并解耦为普通对象再闭包给组件。

## 7. UI 设计

- **chip**：26px 高、12px 字号的内联胶囊，位于输入框工具行右侧；hover 显示精确 tokens 与模型名
  （`title`）；`aria-expanded` 表达弹窗状态。
- **popover**：`role="dialog"`，300px，锚定 chip 右上方；autofocus 输入框；Enter 保存、Escape 关闭；
  遮罩层（backdrop button）点击关闭；保存中三个按钮统一禁用。
- **实时预览**：草稿可解析且 K/M 拼写与裸数字不同时显示 `≈ 128K`（<1K 的值不显示，避免复读）。
- **无障碍**：错误行 `role="alert"`；`aria-label` 完整描述标签与动作。
- **主题**：light/dark 双套 `--ilm-*` CSS 变量 + `prefers-color-scheme`，宿主主题可整体重指向；
  类名经 CSS Modules hash，不污染全局。

## 8. 测试策略

| 层 | 工具 | 内容 |
|---|---|---|
| 数值层单测 | `tests/capacity.test.ts`（vitest）+ `tests/capacity.verify.mjs`（node 原生，无依赖） | 解析/格式化/紧凑拼写全矩阵 + 0.1.1 回归用例 |
| 数据层集成 | `tests/provider.verify.mjs`（node 原生） | 对 mock rc.2 wire（真实 pi-ai route 布局）做读/写/重置/冲突重试端到端 |
| bundle 冒烟 | `tests/bundle-smoke.mjs`（node vm） | 加载 `lib/client.js`，stub `__ModuleLoader__` 与平台 require，断言加载合同（id/name/inject/exports） |
| 手动 E2E | 浏览器 | 见 RELEASING §发布门槛 |

无依赖脚本的存在意义：贡献者无需 `pnpm install` 即可验证核心逻辑（Node ≥ 22 的
`--experimental-strip-types`）。

## 9. 兼容性与升级策略

- **锁定 rc.2**：`inject` 的 dotted faces、`settings.mutate(ns, ops, revision)` 位置参数、
  `modelSelection` 投影面均随 rc.2 声明。官方处于 developer preview，**预期存在破坏性变更**；
  策略是「响亮失败」——faces 改名/移除时插件加载即报错，而非静默失灵。
- dsh 升级后排障顺序：bundle smoke → `dsh --profile web --dump-config` 看层栈 → GUI console
  看 `[dsh-input-limit]` 警告 → 对照新版本 wire 声明更新 `wire.ts`。
- 外部化清单 `PLATFORM_MODULES` 是宿主 loader 冻结表的镜像；宿主增删平台模块时需同步。

## 10. 已知限制与后续方向

- 快照读取无缓存，每次设置文档变更全量重读（当前规模可忽略）。
- 仅覆盖 `conversation.input.right` seat；desktop 载体未验证。
- 后续候选：非可配置 provider 的引导提示；多模型批量设置；与 Settings 页的双向焦点联动。
