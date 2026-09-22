/**
 * Integration verification of src/client/provider.ts against a mock api-remotes
 * wire, faithful to the dsh RPC shape ({ rpcId, result: RpcResult<T> }) and to
 * a real pi-ai deployment (route under `providers.<id>`, models array beside
 * the route fields, defaultContextWindow fallback).
 *
 * Sandbox-friendly: vitest is unavailable here, so run with:
 *   node --experimental-strip-types tests/provider.verify.mjs
 */

import assert from 'node:assert/strict'
import { readLimit, applyModelLimit, resetModelLimit } from '../src/client/provider.ts'

const NS = 'llm-pi-ai'
const ROUTE = 'internal-ds-v4-flash-0731'
const MODEL = 'DeepSeek-V4-Flash-0731'
const SESSION = 's-1'

const ok = (value) => ({ result: { ok: true, value } })
const err = (code, message) => ({ result: { ok: false, error: { code, message, details: {} } } })

function mergeRoute(baseRoute, userRoute) {
  return { ...baseRoute, ...userRoute }
}

/**
 * A two-layer settings document (base = package defaults, user = settings.yaml)
 * for one pi-ai route. `describe()` recomputes the merged view on every call so
 * the "effective" layer reflects the user mutations, exactly like the real
 * settings service does.
 */
function layeredDoc(base, user, options = {}) {
  let revision = options.revision ?? 7
  return {
    bump() {
      revision += 1
    },
    user,
    describe() {
      return ok({
        writable: options.writable ?? true,
        hasDocument: true,
        namespaces: [{
          ns: NS,
          schema: null,
          value: {
            providers: {
              [ROUTE]: mergeRoute(base.providers[ROUTE], user.providers[ROUTE]),
            },
          },
          base,
          user,
          applies: ['app'],
          secrets: [],
          revision,
        }],
      })
    },
    mutate({ ns, ops, expectedRevision }) {
      assert.equal(ns, NS, 'mutate ns')
      if (expectedRevision !== revision) {
        return err('settings-rejected', `revision mismatch: expected ${expectedRevision}, have ${revision}`)
      }
      let changed = false
      for (const op of ops) {
        assert.equal(op.op, 'set', 'only set ops here')
        assert.equal(op.path[0], 'providers', `path root ${op.path.join('.')}`)
        assert.equal(op.path[1], ROUTE, `route segment ${op.path.join('.')}`)
        if (op.path[2] === 'models') {
          user.providers[ROUTE].models = op.value
          changed = true
        }
      }
      if (changed) revision += 1
      return ok({ ns, revision })
    },
  }
}

function apiOf(doc) {
  return {
    sessions: {
      models: () => ok({ current: { provider: ROUTE, model: MODEL }, groups: [], failures: [], routable: [] }),
    },
    llm: {
      providers: () => ok({
        providers: [{ provider: ROUTE, displayName: ROUTE, settingsNs: NS, settingsPath: ['providers', ROUTE], active: true }],
      }),
    },
    settings: doc,
  }
}

async function scenario(name, baseRoute, userRoute, fn) {
  const base = { providers: { [ROUTE]: baseRoute } }
  const user = { providers: { [ROUTE]: userRoute } }
  const doc = layeredDoc(base, user)
  await fn(doc)
  console.log(`provider.verify OK — ${name}`)
}

await scenario('read: no per-model limit -> inherits route default', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const read = await readLimit(apiOf(doc), SESSION)
  assert.equal(read.editable, true)
  assert.equal(read.writable, true)
  assert.equal(read.namespace, NS)
  assert.deepEqual([...read.modelsPath], ['providers', ROUTE, 'models'])
  assert.equal(read.limit, undefined)
  assert.equal(read.defaultLimit, 262144)
})

await scenario('apply: writes per-model override, appends when absent', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const out = await applyModelLimit(apiOf(doc), SESSION, 131_072)
  assert.equal(out.failure, null)
  assert.equal(out.limit, 131_072)
  assert.deepEqual(doc.user.providers[ROUTE].models, [{ id: MODEL, contextWindow: 131_072 }])
  assert.equal(doc.describe().result.value.namespaces[0].revision, 8, 'revision bumped')
  const read = await readLimit(apiOf(doc), SESSION)
  assert.equal(read.limit, 131_072, 'now effective')
})

await scenario('apply: preserves sibling model rows', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [
    { id: 'other-model', name: 'other', contextWindow: 1000 },
    { id: MODEL, name: 'target' },
  ],
}, async (doc) => {
  const out = await applyModelLimit(apiOf(doc), SESSION, 64_000)
  assert.equal(out.failure, null)
  assert.deepEqual(doc.user.providers[ROUTE].models, [
    { id: 'other-model', name: 'other', contextWindow: 1000 },
    { id: MODEL, name: 'target', contextWindow: 64_000 },
  ])
})

await scenario('reset: drops override when base has none (falls back to default)', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [{ id: MODEL, contextWindow: 131_072 }],
}, async (doc) => {
  const out = await resetModelLimit(apiOf(doc), SESSION)
  assert.equal(out.failure, null)
  assert.equal(out.limit, undefined)
  assert.deepEqual(doc.user.providers[ROUTE].models, [{ id: MODEL }], 'field dropped')
  const read = await readLimit(apiOf(doc), SESSION)
  assert.equal(read.limit, undefined)
  assert.equal(read.defaultLimit, 262144, 'fallback intact')
})

await scenario('reset: restores base value when base declares one', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144,
  models: [{ id: MODEL, contextWindow: 250_000 }],
}, {
  id: ROUTE, model: MODEL, models: [{ id: MODEL, contextWindow: 100_000 }],
}, async (doc) => {
  const out = await resetModelLimit(apiOf(doc), SESSION)
  assert.equal(out.failure, null)
  assert.equal(out.limit, 250_000)
  assert.deepEqual(doc.user.providers[ROUTE].models, [{ id: MODEL, contextWindow: 250_000 }])
})

await scenario('reset: no-op when no user-owned models row', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL,
}, async (doc) => {
  const out = await resetModelLimit(apiOf(doc), SESSION)
  assert.equal(out.failure, null)
  assert.equal(out.limit, undefined, 'nothing to restore')
})

await scenario('read: non-configurable provider hides the seat', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL,
}, async (doc) => {
  const api = apiOf(doc)
  api.llm.providers = () => ok({
    providers: [{ provider: ROUTE, displayName: ROUTE, settingsNs: '', settingsPath: [], active: true }],
  })
  const read = await readLimit(api, SESSION)
  assert.equal(read.editable, false)
})

await scenario('write: apply always re-reads so it never trusts a stale revision', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const out = await applyModelLimit(apiOf(doc), SESSION, 1_000_000)
  assert.equal(out.failure, null, 'fresh revision writes cleanly')
  const read = await readLimit(apiOf(doc), SESSION) // revision now 8
  assert.equal(read.limit, 1_000_000)
  // Another actor bumps the document out from under us; applyModelLimit
  // re-describes internally so it still carries a fresh expectedRevision.
  doc.bump()
  const out2 = await applyModelLimit(apiOf(doc), SESSION, 64_000)
  assert.equal(out2.failure, null, 'apply re-reads the document, so no stale revision')
  assert.equal(out2.limit, 64_000)
})
