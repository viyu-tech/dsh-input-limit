/**
 * Load-time smoke test for the built client bundle: evaluate `lib/client.js`
 * in an isolated `vm` context under a stub `window.__ModuleLoader__`, drive its
 * factory with a stubbed platform require, and assert the loader contract
 * (id, name, inject, apply).
 *
 * Run with: node tests/bundle-smoke.mjs   (after `pnpm run build`)
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')
const source = readFileSync(bundlePath, 'utf8')

// The factory must only touch platform-module externals at load time; react is
// required for real inside component bodies, so a bare stub is enough here.
const stubs = new Map([
  ['react', {}],
  ['react/jsx-runtime', { jsx() {}, jsxs() {}, Fragment: Symbol('Fragment') }],
])
const requireStub = (id) => {
  if (stubs.has(id)) return stubs.get(id)
  throw new Error(`unexpected external require: ${id}`)
}

let loaded = null
let factoryThrew = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(payload) {
        loaded = payload
        payload.exports = undefined
        try {
          payload.exports = payload.factory(requireStub)
        } catch (error) {
          factoryThrew = error
        }
      },
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.bundle.js' })

if (factoryThrew !== null) {
  console.error('factory threw:', factoryThrew)
  process.exit(1)
}
if (loaded === null) {
  console.error('load was never called')
  process.exit(1)
}
if (loaded.id !== 'dsh-input-limit') {
  console.error(`bad bundle id: ${loaded.id}`)
  process.exit(1)
}

const mod = loaded.exports
if (typeof mod !== 'object' || mod === null) {
  console.error('bundle did not expose module.exports')
  process.exit(1)
}
if (mod.name !== 'dsh-input-limit') {
  console.error(`bad plugin name: ${mod.name}`)
  process.exit(1)
}
if (!Array.isArray(mod.inject)) {
  console.error('inject is not an array')
  process.exit(1)
}
if (typeof mod.apply !== 'function') {
  console.error('apply is not a function')
  process.exit(1)
}

console.log('bundle smoke OK', JSON.stringify({
  id: loaded.id,
  name: mod.name,
  inject: mod.inject,
  exports: Object.keys(mod).sort(),
}))
