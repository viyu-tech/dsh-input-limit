/**
 * Build configuration for dsh-input-limit.
 *
 * Two artifacts:
 *  - `lib/index.js`   — the Host (Node) half: a no-op entry whose presence as a
 *                       loader row makes the Host serve and activate the browser half.
 *  - `lib/client.js`  — the browser half, emitted as the DSH closure-factory
 *                       bundle the web shell's `__ModuleLoader__` consumes.
 *
 * A compatible client bundle externalizes the platform modules the web shell
 * shares into its module table (react, cordis, ui-slots, ...) and inlines
 * everything else, wrapping the output in
 * `window.__ModuleLoader__.load({ id, factory })`. CSS Modules are compiled
 * with lightningcss and injected as a `<style data-plugin>` element. This is
 * the same contract `packages/client/tsdown.client.ts` enforces for the
 * built-in UI plugins, reproduced here so the plugin builds standalone.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_NAME = 'dsh-input-limit'
const ROOT = fileURLToPath(new URL('.', import.meta.url))

/**
 * Browser platform modules the shell shares into the frozen loader table.
 * Mirror of `PLATFORM_MODULES` in the harness's `packages/client/web/src/platform.ts`;
 * a bundle may only externalize (require from the table) these module ids.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Module-table externals a client bundle may require at runtime. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

/** Virtual id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/** Host half: a plain ESM Node bundle. */
const nodeConfig: UserConfig = {
  name: `${PACKAGE_NAME}/node`,
  entry: { index: resolvePath(ROOT, 'src/index.ts') },
  outDir: resolvePath(ROOT, 'lib'),
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: false,
  clean: false,
}

/** Browser half: the DSH closure-factory bundle served as `/plugins/dsh-input-limit/client.js`. */
const clientConfig: UserConfig = {
  name: `${PACKAGE_NAME}/client`,
  entry: { client: resolvePath(ROOT, 'src/client/index.ts') },
  outDir: resolvePath(ROOT, 'lib'),
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${PACKAGE_NAME}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeConfig, clientConfig]
