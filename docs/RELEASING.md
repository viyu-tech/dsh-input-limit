# dsh-input-limit 发布文档

> 适用版本 0.1.1 · 目标 dsh 0.1.5-rc.2
> **约定：本文所有「上传/推送/发布」动作均由维护者手动执行**，本文只提供精确步骤与预期输出。
> 设计细节见 [DESIGN](DESIGN.md)；用户视角安装说明同时维护在根目录 [README](../README.md#install)。

---

## 1. 发布门槛（全部满足才允许发布）

| # | 门槛 | 命令 / 方式 | 状态（0.1.1） |
|---|---|---|---|
| 1 | 数值层验证 | `node --experimental-strip-types tests/capacity.verify.mjs` | ✅ 已过（50+ 断言，含千分位编辑回归） |
| 2 | bundle 冒烟 | `node tests/bundle-smoke.mjs` | ✅ 已过 |
| 3 | 数据层集成 | `node --experimental-strip-types tests/provider.verify.mjs` | ⏳ 发布前必跑 |
| 4 | vitest 套件 | `pnpm run test` | ⏳ 发布前必跑 |
| 5 | 类型检查 | `pnpm run typecheck` | ⏳ 发布前必跑 |
| 6 | 浏览器 E2E | 见 §1.1 场景清单 | ⏳ 发布前必跑 |
| 7 | 版本号 | `package.json` `version` 与本次变更匹配 | ✅ 0.1.1 |
| 8 | 预构建产物与源码一致 | 改过 `src/` 就必须 `pnpm run build` 重新生成 `lib/` | ✅（0.1.1 已同步；再次改动后重跑） |
| 9 | npm 元信息占位已替换 | `package.json` 中 `<YOUR_GITHUB_ACCOUNT>` 占位（`author`/`repository`/`bugs`/`homepage`）替换为真实 GitHub 账号 | ⏳ 发布前必改 |

### 1.1 浏览器 E2E 场景清单

1. 输入框工具行出现「输入上限」胶囊，含 K/M 值；无覆盖值时带 `· 默认`。
2. 悬浮显示精确 tokens 与模型名；点击开弹窗，预填分组拼写（如 `20,000`）。
3. **回归场景（0.1.1）**：预填值末尾直接追加数字 → 出现 `≈` 预览，可保存，不再报
   「请输入正整数 token 数」。
4. 输入 `128K`、`1.5`、`0`、`,123`、`12 34` → 保存时报错且不落盘；错误行文案正确。
5. 保存后胶囊实时更新、`· 默认` 标签消失；Settings 页对应 provider → models 行出现
   `contextWindow` 覆盖值。
6. 「恢复默认」→ 覆盖字段被移除，胶囊回落默认值并重新出现 `· 默认`。
7. 两个浏览器标签页同时打开：一侧保存，另一侧胶囊无需刷新即更新。
8. 切换会话模型 → 胶囊跟随新模型；切换到子代理会话 → 胶囊消失。
9. 暗色模式外观正常；Enter 保存、Escape 关闭、点击遮罩关闭。

## 2. 产出物定义

**npm 包 / GitHub 仓库都携带预构建 `lib/`**，安装方零工具链、零构建。

| 产出物 | 内容 | 说明 |
|---|---|---|
| npm tarball | `files` 白名单：`lib/`、`cordis.patch.yml`、`README.md`、`LICENSE` | `node_modules`、`*.tgz`、src/tests/docs 不入包 |
| GitHub 仓库 | 全部源码 + `lib/` + tests + docs | `lib/` 必须提交——`dsh plugin add github:…` 的机器可能没有构建条件 |
| GitHub Release | tag `v0.1.1` + Release Notes（可直接用本文 §7 版本记录） | 附源码 zip 即可，无需附加 tarball |
| `pnpm view dsh-input-limit` | 发布前查名 | 期望 404（名字未被占用）；若被占用，改用 scope 包名并同步 `package.json` |

## 3. 官方要求合规清单

依据：官方 [README](https://github.com/deepseek-ai/deepseek-harness)、
[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、
[插件开发教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)、
本机 rc.2 CLI 实现源码（`@deepseek-ai/dsh/lib/plugin-*.js`），以及 **本机 rc.2 实测
（插件已真实加载并工作）**。

| 官方要求 | 本文现状 | 结论 |
|---|---|---|
| 插件 = 导出 `name` + `apply(ctx)`（可选 `inject`）的模块（官方教程） | Host/Client 两端均为函数式插件，导出 `name/inject/apply`；dotted 依赖显式声明于 `inject` | ✅ |
| bundle 在自身 `package.json` 声明 `dsh.bundle` → patch 文件（架构文档） | `dsh.bundle.patch: ./cordis.patch.yml` | ✅ |
| patch 形态：按 `id` 插入/替换配置行（架构文档） | `- insert: - { id: input-limit, name: dsh-input-limit }` | ✅ |
| 外部插件经 `dsh plugin` 安装，pnpm 落入 profile，`dsh.bundle` 声明者自动入层栈（CLI 实现） | 已在本机 `~/.dsh/profiles/web` 以 link 方式入层，`--dump-config` 可见 | ✅ |
| 浏览器半：`window.__ModuleLoader__.load({ id, factory })` 闭包工厂，仅外部化平台模块，CSS Modules 内联 `<style data-plugin>`（web shell 合同） | `tsdown.config.ts` 逐条复刻内置合同；`bundle-smoke.mjs` 机械验证 | ✅ |
| 注册可逆（Cordis `ctx.effect`） | locale 注册、事件订阅均为 effect；组件退订精确 | ✅ |
| 开源许可 | MIT `LICENSE` 随包 | ✅ |
| 社区可发现性：仓库添加 GitHub topic **`dsh-plugin`**（官方 README 指定） | ⏳ **发布时手动添加**（见 §4 步骤 A-4） | 待办 |
| 兼容性声明 | README「Compatibility notes」锁定 rc.2，faces 变更将响亮失败 | ✅ |
| 官方文档站核对 | <https://deepseek-harness.github.io/deepseek-harness/> | 建议发布前人工过一遍是否有新增插件登记要求 |

> 说明：官方对社区插件**没有**中心化审核/注册表/市场。分发完全走 npm / GitHub / 本地路径 /
> tarball 四种 pnpm 来源；「官方要求」即上述加载合同 + 发现机制。GUI 侧的接触面只有两处：
> 侧边栏 Plugins 页的 **Add plugin**（按 spec 经 registry 查询后安装，不搜索市场）和
> Settings → Plugins 的 **Plugin list**（**只读**本机清单，搜索框仅过滤已安装条目）。

## 4. 发布流程（维护者手动执行）

### A. GitHub 发布

```sh
cd D:\deepseek\dsh-plugin-input-limit
# 先把 package.json 里的 <YOUR_GITHUB_ACCOUNT> 占位替换为真实账号（门槛 #9）
git init && git add -A && git commit -m "dsh-input-limit 0.1.1"
```

1. 在 GitHub 创建**空**仓库，名为 `dsh-input-limit`（不要勾选自动生成 README/LICENSE）。
2. `git remote add origin https://github.com/<你>/dsh-input-limit.git && git push -u origin master`
   （或 `main`，与你本地分支一致）。
3. 打 tag 并发 Release：`git tag v0.1.1 && git push origin v0.1.1`，Release Notes 粘贴本文 §7。
4. **仓库 Settings → Topics（About 齿轮）添加 `dsh-plugin`** ←—— 官方指定的社区插件发现机制，
   同时建议加 `deepseek-harness`、`dsh`。

### B. npm 发布（**强烈推荐——GUI 内可安装的前提**）

```sh
pnpm publish        # 自动执行 prepare → tsdown 重建 lib/ 后打包
```

- **为什么不是可选**：Web UI 侧边栏「Plugins → Add plugin」对话框是其他用户最主要的
  自助安装入口，它按包名到 registry 查询（`pnpm view`，默认 registry + 内置
  npmmirror 兜底）。**只有发布到 npm，别的用户才能在界面里输入 `dsh-input-limit`
  一键安装**；只发 GitHub 的话，其他用户只能手动粘贴 git 地址或用命令行。
- `package.json` 的 `keywords` 已含 `dsh` / `dsh-plugin` / `deepseek-harness`，
  `description` 是 npm 与安装预览展示的一句话文案，发布前确认两者无误。
- 首次发布前 `pnpm view dsh-input-limit` 确认包名可用。
- `pnpm publish` 对工作区脏文件敏感：先提交全部变更。
- npmmirror（内置兜底 registry）从 npm 同步有延迟，国内用户首次查询若 404，
  GUI 会自动落到默认 registry，不影响安装。

### C. 发布后自验（模拟新用户）

```sh
# 干净环境：换一个 DSH_HOME 或临时 profile
dsh plugin --profile web-test add dsh-input-limit     # 或 github:<你>/dsh-input-limit
dsh --profile web-test --dump-config                  # 期望层栈里出现 dsh-input-limit
dsh --profile web-test                                # GUI 冒烟：跑一遍 §1.1 场景 1/2/3
dsh plugin --profile web-test remove dsh-input-limit  # 卸载自验
```

### D. 第三方市场与社区索引（发布后，可选但推荐）

[dsh.so](https://www.dsh.so/zh/) 是**独立社区**插件市场（与 DeepSeek AI 无隶属），
聚合 GitHub 与 npm 公开数据，提供 L1–L5 验证阶梯与安全扫描。对我们要点：

**自动索引**：仓库加上 `dsh-plugin` topic 后（步骤 A-4）会被 dsh.so 自动收录；
也可在 [提交页](https://www.dsh.so/zh/submit/) 粘贴仓库地址主动提交（服务端重扫，
条目以 Issue 归档供人工合入）。其验收标准我们已逐条满足：

| dsh.so 接受标准 | 本项目状态 |
|---|---|
| DSH 兼容信号（`package.json` 的 `dsh` 字段 / topic 等） | ✅ `dsh.bundle` + `dsh.client` 字段齐全 |
| README 带安装说明 | ✅ |
| 开源许可证（SPDX 可识别） | ✅ MIT |
| 仓库名符合 `^[a-z0-9]+(-[a-z0-9]+)*$` | ✅ `dsh-input-limit` |
| 源码可扫描 | ✅ TS 源码 + 可读 bundle |
| 安全扫描（无硬编码密钥/外传端点/破坏性操作） | ✅ 纯本地 RPC、零网络外呼、零密钥 |

**收录级别预期**：初始为 **Declared（声明兼容）**——dsh.so 只对它独立实测过的
版本标 Verified。它的沙盒当前主测较新的 dsh 版本；我们声明锁定 rc.2，
若在新版本上实测通过，可按其模板发官方 Discussions 兼容性报告，结果会并入其矩阵。

**其他渠道**（都是发布后的低成本动作）：
- [awesome-dsh-plugin](https://github.com/topics/dsh-plugin) 精选列表（万星级）：提 PR 收录本插件；
- npm 发布的额外价值：dsh.so 下载榜、以及 `dsh-market` 等内置市场类插件按 npm/索引
  拉取插件，上了 npm 才会在那些界面里可见；
- GitHub 仓库描述写成一句中英双语，README 放 1–2 张截图或 GIF（dsh.so 条目页会引用，
  明显提升转化）。

## 5. 其他用户安装指南（对外文案，README 同步维护）

前置：已安装 `dsh`（≥ 0.1.5-rc.2，需 Node ≥ 20）与 **pnpm**；Web UI 正常运行。

### 在 Web UI 里安装（推荐）

侧边栏 **Plugins → Add plugin**，输入包名 `dsh-input-limit`，选 registry（默认 npm，
内置 npmmirror 兜底），Install → Enable now。对话框会先展示从 registry 读到的
名称 / 版本 / 一句话描述 / 是否插件包，确认后才落盘；pnpm 构建脚本被拦时页面会给出
「Allow these scripts and retry」（本包 `lib/` 预构建，通常无需允许）。

### 从 npm（命令行等价）

```sh
dsh plugin --profile web add dsh-input-limit
dsh web        # 重启或刷新 http://127.0.0.1:3080
```

### 从 GitHub

```sh
dsh plugin --profile web add github:<你>/dsh-input-limit
```

> pnpm 默认拦截 git 依赖的 `prepare` 构建脚本；本仓库 `lib/` 预构建随仓库分发，
> **被拦截也不影响使用**。若 pnpm 打印 allowBuilds 提示且你希望安装时重建，把 pnpm
> 输出的那个 key 加入 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑。
> Git 来源无法走 GUI 的包名安装框，需粘贴完整地址。

### 从本地目录 / tarball

```sh
dsh plugin --profile web add D:\path\to\dsh-input-limit     # 相对路径会被自动锚定
dsh plugin --profile web add ./dsh-input-limit-0.1.1.tgz
```

### 装完后在哪里能看到

- 侧边栏 **Plugins** 页「Installed」分组出现本包卡片（标题/描述取自 `package.json`）。
- Settings → Plugins 的「Plugin list」标签页（**只读清单，搜索框过滤的是本机已装插件**，
  不是市场）里能看到已挂载的插件行。
- 输入框工具行出现「输入上限」胶囊。

### 管理

```sh
dsh plugin --profile web why dsh-input-limit      # 查看安装状态
dsh plugin --profile web add dsh-input-limit      # 升级（npm 来源时同命令取新版本）
dsh plugin --profile web remove dsh-input-limit   # 卸载（自动移出 bundle 层栈）
```

### 验证安装成功

1. `dsh --profile web --dump-config` 的 bundle 列表含 `dsh-input-limit`；
2. Web UI 输入框工具行出现「输入上限」胶囊；
3. 卸载后胶囊消失（无需清理 settings——覆盖值留在文档中无害，重装后自动生效）。

## 6. 版本兼容性声明

- 仅声明支持 `dsh` **0.1.5-rc.2**（官方 developer preview 期，破坏性变更是预期内的）。
- dsh 升级后的排查顺序：`node tests/bundle-smoke.mjs` → `--dump-config` 看层栈 → GUI console
  搜 `[dsh-input-limit]` → 对照新版 wire 声明更新 `src/client/wire.ts` 与 `inject` 列表。
- 插件语义化版本：主版本随不兼容的 dsh face 变更递增。

## 7. 版本记录（可直接粘贴为 Release Notes）

### 0.1.1

- **修复**：弹窗重新打开时预填千分位分组值（如 `20,000`），随后编辑（追加/删除数字、
  非三位分组如 `13,1072`）被误判非法并报「请输入正整数 token 数」。现在千分位逗号按
  display-only 分隔符处理：`20,0000` → 200000 照常解析；仍拒绝 `,123`、`123,`、`13,,1072`、
  `128K`、`1.5`、`0` 等非正整数输入。回归用例已入 `tests/capacity.test.ts` 与
  `tests/capacity.verify.mjs`。

### 0.1.0

- 首个功能版本：composer 工具行「输入上限」胶囊；弹窗设置/恢复 per-model `contextWindow`
  覆盖；settings 冲突自动重试；zh/en 双文案；暗色模式；子代理会话隐藏。
