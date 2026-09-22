# dsh-input-limit

> 直接在 dsh web 对话页设置当前大模型的输入上限（上下文窗口）。

A community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) that adds a small chip to the **composer tool row** — right next to the
model picker — showing the current model's input limit and letting you **change
it on the spot**, without digging through the Settings page.

## What it does

- Shows the current model's effective input limit (context window) as a tiny
  pill in the message input bar, e.g. `输入上限 128K` (`Input limit 128K`).
  A `· 默认` tag means the value is inherited from the provider default.
  Hovering shows the exact token count.
- Click the pill → a popover lets you type an **exact token count** (one unit —
  e.g. `131072`, or `131,072`) with a live `≈ 128K` equivalent shown while you
  type, then **Save**, or **Reset to default**.
- Persists a **per-model `contextWindow` override** into the provider's settings
  section (`llm-pi-ai` / `llm-deepseek`) via the same typed RPCs the Settings
  page uses. The change is live on the next request — it drives **context
  pressure display and auto-compaction**, so a model whose real input limit is
  smaller than the adapter default (e.g. 128K vs the pi-ai default 262144) is
  accounted for correctly.
- Writes go through a fresh settings read and are retried once automatically
  when the document moved in the meantime (`settings/conflict`), so two open
  editors never clobber each other silently.

Numbers use the **binary scale** model capacities are conventionally quoted in
(`1K` = 1024, `1M` = 1024²): `131072` reads `128K`, and the pi-ai default
`262144` reads `256K`.

It works for every configurable provider (pi-ai routes, the direct DeepSeek
adapter), hides itself when the current model/provider is not configurable, and
is a **browser-only** plugin: no custom host code, no server restart required
beyond loading the plugin itself.

## Install

Requirements: `dsh` CLI (tested on `0.1.5-rc.2`, works with any build that
ships the web UI plugin system), **pnpm** (the plugin installer drives it), and
a configurable provider (pi-ai or deepseek-official).

> The web UI is the `web` profile. Installing into it and restarting `dsh web`
> is all it takes.

### From the Web UI (recommended)

Once the package is on npm: sidebar **Plugins → Add plugin**, type
`dsh-input-limit`, pick the registry (npm by default, npmmirror as the built-in
fallback), then **Install → Enable now**.

### From npm

```sh
dsh plugin --profile web add dsh-input-limit
dsh web
```

### From GitHub

```sh
dsh plugin --profile web add github:<you>/dsh-input-limit
dsh web
```

> pnpm blocks build scripts of git-hosted dependencies by default; this repo
> ships prebuilt `lib/`, so a blocked `prepare` is harmless. To rebuild on
> install instead, add the key pnpm prints under `allowBuilds` in the profile's
> `pnpm-workspace.yaml` and re-run.

### From a local checkout / tarball

```sh
# from a directory that contains the plugin package
dsh plugin --profile web add ./dsh-input-limit
dsh web          # restart (or re-open http://127.0.0.1:3080)
```

### Uninstall

```sh
dsh plugin --profile web remove dsh-input-limit
```

## Build from source

`lib/` ships prebuilt in this repo, so installs from a checkout or GitHub work
without a toolchain. To rebuild or iterate:

```sh
pnpm install
pnpm run build     # emits lib/index.mjs (host half) + lib/client.js (browser half)
pnpm run typecheck
pnpm run test
```

The browser bundle is emitted in the exact closure-factory format the dsh web
shell's `__ModuleLoader__` consumes (platform modules externalized, everything
else inlined, CSS Modules compiled with lightningcss and injected as a
`<style data-plugin>` element) — the same contract the built-in UI plugins use.

Dependency-free sanity checks (no install needed, Node ≥ 22):
`node tests/bundle-smoke.mjs` (loads `lib/client.js` under a stub
`__ModuleLoader__`), plus `node --experimental-strip-types tests/capacity.verify.mjs`
and `tests/provider.verify.mjs` (logic + an end-to-end run against a mock rc.2
client wire — the Typert `ctx.remote` namespaces and the `ctx.sessions` object
layer — built from a real pi-ai route layout).

## How it works

- `cordis.patch.yml` mounts one plugin row; the host half (`src/index.ts`) is a
  no-op whose presence makes the Host serve the browser half.
- `src/client/index.ts` registers a component into the composer's
  `conversation.input.right` list seat. Services are read through `ctx.get`
  inside the plugin fiber and the concrete `settings`/`session` faces are
  detached there, so no component-time callback ever touches the Cordis
  context proxy.
- `src/client/provider.ts` resolves the session's current model from its
  durable `modelSelection` projection (`ctx.sessions`), maps it to the
  provider's settings namespace via `ctx.remote.settings.describe()`, reads the
  effective context window, and writes the override with
  `ctx.remote.settings.mutate(ns, ops, expectedRevision)` (preserving the rest
  of the models array). The forwarded `settings/document-updated` event and the
  session's model projection refresh open chips live.

## Compatibility notes

- Tested on `dsh` **0.1.5-rc.2**. The client plugin declares the dotted
  services it dereferences (`remote.settings`, `remote.session`) in its
  `inject` list — required by the Cordis context proxy; older/newer builds that
  rename or drop these faces will fail the plugin load loudly rather than
  misbehave silently.

## Development & contributing

- Product copy is Chinese (`src/client/locales.ts` ships a matching English
  dictionary); code comments are English.
- Design deep-dive: [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, data flow,
  parser rules, and the Cordis pitfalls this plugin works around.
- Release process & official-requirements checklist:
  [`docs/RELEASING.md`](docs/RELEASING.md).
- PRs welcome. Keep the client bundle's external list to the platform modules
  (react/cordis/ui-slots/...); everything else must inline.

## Publish to the community

To make the plugin discoverable as an official community plugin:

1. Create a GitHub repository (`dsh-input-limit`) and push this directory.
2. On the repository **Settings → Topics**, add the **`dsh-plugin`** topic
   ([topic listing](https://github.com/topics/dsh-plugin)) — this is what the
   official README designates for plugin discoverability.
3. Optionally publish to npm:

   ```sh
   pnpm publish     # runs `prepare` → rebuilds lib/ and ships it
   ```

The full release gates, artifact definitions, compliance checklist, and
post-publish verification live in [`docs/RELEASING.md`](docs/RELEASING.md).

## License

MIT
