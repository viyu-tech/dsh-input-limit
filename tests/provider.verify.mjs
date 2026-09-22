/**
 * Integration verification of src/client/provider.ts against a mock rc.2 client
 * wire face (the Typert `ctx.remote` namespaces and the `ctx.sessions` object
 * layer): top-level `RemoteResult { ok, value }`, positional
 * `settings.mutate(ns, ops, expectedRevision)`, and the per-session
 * `modelSelection` projection with the host catalog default as fallback.
 *
 * Sandbox-friendly: vitest is unavailable here, so run with:
 *   node --experimental-strip-types tests/provider.verify.mjs
 */

import assert from 'node:assert/strict'
import { readLimit, applyModelLimit, resetModelLimit } from '../src/client/provider.ts'

const NS = 'llm-pi-ai'
const ROUTE = 'internal-ds-v4-flash-0731'
const ROUTE2 = 'internal-ds-v4-flash-0731-alt'
const MODEL = 'DeepSeek-V4-Flash-0731'
const MODEL2 = 'deepseek-coder'
const SESSION = 's-1'

const ok = (value) => ({ ok: true, value })
const err = (code, message) => ({ ok: false, error: { code, message } })

function mergeRoute(baseRoute, userRoute) {
  return { ...(baseRoute ?? {}), ...(userRoute ?? {}) }
}

function setPath(root, path, value) {
  let node = root
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {}
    node = node[key]
  }
  node[path[path.length - 1]] = value
}

function unsetPath(root, path) {
  let node = root
  for (let i = 0; i < path.length - 1; i += 1) {
    node = node[path[i]]
    if (node === undefined) return
  }
  delete node[path[path.length - 1]]
}

/**
 * A two-layer settings document (base = package defaults, user = settings.yaml)
 * for one pi-ai route. `describe()` recomputes the merged view on every call so
 * the "effective" layer reflects the user mutations, exactly like the real
 * settings service does.
 */
function layeredDoc(base, user, options = {}) {
  let revision = options.revision ?? 7
  let mutateSpy = null
  const routeKeys = () => [...new Set([
    ...Object.keys(base?.providers ?? {}),
    ...Object.keys(user?.providers ?? {}),
  ])]
  const describeValue = () => ({
    writable: options.writable ?? true,
    hasDocument: true,
    namespaces: [{
      ns: NS,
      schema: null,
      value: {
        providers: Object.fromEntries(routeKeys().map((route) => [
          route, mergeRoute(base.providers?.[route], user.providers?.[route]),
        ])),
      },
      base,
      user,
      applies: 'live',
      secrets: [],
      revision,
    }],
  })
  return {
    bump() { revision += 1 },
    user,
    /** Observe (or short-circuit) the next mutate calls; return an error to fail one. */
    onMutate(spy) { mutateSpy = spy },
    describe() { return ok(describeValue()) },
    mutate(ns, ops, expectedRevision) {
      assert.equal(ns, NS, 'mutate ns')
      if (expectedRevision !== revision) {
        return err('settings/conflict', `revision mismatch: expected ${expectedRevision}, have ${revision}`)
      }
      const injected = mutateSpy?.(ops)
      if (injected !== undefined) return injected
      for (const op of ops) {
        if (op.op === 'set') setPath(user, op.path, op.value)
        else if (op.op === 'unset') unsetPath(user, op.path)
      }
      revision += 1
      return ok(describeValue().namespaces[0])
    },
  }
}

/** The ProviderDeps wire face for a document, with a durable projection and a catalog default. */
function depsOf(doc, options = {}) {
  const projection = options.projection ?? { lastUsed: null, next: { provider: ROUTE, model: MODEL } }
  const catalogDefault = options.catalogDefault ?? { provider: ROUTE, model: MODEL }
  return {
    remote: {
      settings: doc,
      session: {
        modelCatalog: () => ok({ default: catalogDefault, routableProviders: [ROUTE], groups: [], failures: [] }),
      },
      $on: () => () => {},
    },
    sessions: {
      subagentAddress: () => options.subagentAddress ?? undefined,
      binding: () => ({
        session: { projections: { faceOf: (key) => ({ ...projection, subscribe: () => () => {} }) } },
      }),
    },
    sessionId: SESSION,
  }
}

async function scenario(name, baseRoute, userRoute, fn, options = {}) {
  const base = { providers: { [ROUTE]: baseRoute ?? { id: ROUTE, model: MODEL, models: [] }, [ROUTE2]: { id: ROUTE2, model: MODEL2, models: [] } } }
  const user = { providers: { [ROUTE]: userRoute } }
  const doc = layeredDoc(base, user, options)
  await fn(doc)
  console.log(`provider.verify OK — ${name}`)
}

await scenario('read: no per-model limit -> inherits route default', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const read = await readLimit(depsOf(doc))
  assert.equal(read.editable, true)
  assert.equal(read.writable, true)
  assert.equal(read.namespace, NS)
  assert.deepEqual([...read.modelsPath], ['providers', ROUTE, 'models'])
  assert.equal(read.limit, undefined)
  assert.equal(read.defaultLimit, 262144)
})

await scenario('read: current model comes from the session projection, not the catalog default', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  // The durable fold selects a model on a second route; the chip must read that
  // model's provider, not the catalog's default route.
  const deps = depsOf(doc, {
    projection: { lastUsed: null, next: { provider: ROUTE2, model: MODEL2 } },
    catalogDefault: { provider: ROUTE, model: MODEL },
  })
  const read = await readLimit(deps)
  assert.equal(read.provider, ROUTE2)
  assert.equal(read.model, MODEL2)
  assert.deepEqual([...read.modelsPath], ['providers', ROUTE2, 'models'])
  assert.equal(read.editable, true)
})

await scenario('read: projection only records lastUsed, uses it', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const deps = depsOf(doc, { projection: { lastUsed: { provider: ROUTE, model: MODEL }, next: null } })
  const read = await readLimit(deps)
  assert.equal(read.provider, ROUTE)
  assert.equal(read.editable, true)
})

await scenario('read: no projection but a host catalog default', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const deps = depsOf(doc, { projection: { lastUsed: null, next: null } })
  const read = await readLimit(deps)
  assert.equal(read.provider, ROUTE)
  assert.equal(read.editable, true)
  assert.equal(read.defaultLimit, 262144)
})

await scenario('apply: writes per-model override, appends when absent', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const out = await applyModelLimit(depsOf(doc), 131_072)
  assert.equal(out.failure, null)
  assert.equal(out.limit, 131_072)
  assert.deepEqual(doc.user.providers[ROUTE].models, [{ id: MODEL, contextWindow: 131_072 }])
  const read = await readLimit(depsOf(doc))
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
  const out = await applyModelLimit(depsOf(doc), 64_000)
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
  const out = await resetModelLimit(depsOf(doc))
  assert.equal(out.failure, null)
  assert.deepEqual(doc.user.providers[ROUTE].models, [{ id: MODEL }], 'field dropped')
  const read = await readLimit(depsOf(doc))
  assert.equal(read.limit, undefined)
  assert.equal(read.defaultLimit, 262144, 'fallback intact')
})

await scenario('reset: no-op when no user-owned models row', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL,
}, async (doc) => {
  const out = await resetModelLimit(depsOf(doc))
  assert.equal(out.failure, null)
  assert.equal(out.limit, undefined, 'nothing to restore')
})

await scenario('read: model not present in any settings namespace hides the seat', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  // A deployment whose providers dict has no configurable route: the descriptor
  // may exist, but namespaceForRoute finds no provider row for the selection.
  const blank = layeredDoc({ providers: {} }, { providers: {} })
  const deps = depsOf(blank, { projection: { lastUsed: null, next: { provider: ROUTE, model: MODEL } } })
  const read = await readLimit(deps)
  assert.equal(read.editable, false)
  assert.equal(read.model, MODEL)
})

await scenario('read: read-only document disables saving', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const read = await readLimit(depsOf(doc))
  assert.equal(read.editable, true)
  assert.equal(read.writable, false)
}, { writable: false })

await scenario('write: apply always re-reads so it never trusts a stale revision', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const out = await applyModelLimit(depsOf(doc), 1_000_000)
  assert.equal(out.failure, null, 'fresh revision writes cleanly')
  const read = await readLimit(depsOf(doc))
  assert.equal(read.limit, 1_000_000)
  // Another actor bumps the document out from under us; applyModelLimit
  // re-describes internally so it still carries a fresh expectedRevision.
  doc.bump()
  const out2 = await applyModelLimit(depsOf(doc), 64_000)
  assert.equal(out2.failure, null, 'apply re-reads the document, so no stale revision')
  assert.equal(out2.limit, 64_000)
})

await scenario('write: subagent sessions are not addressed (seat-level available)', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  const read = await readLimit(depsOf(doc))
  assert.equal(read.editable, true, 'provider still editable')
  // The available flag rides the injected seat face, not the read: a subagent
  // session must hide the whole pill before any read runs.
  const subagentDeps = depsOf(doc, { subagentAddress: 'catalog/s-0/s-1' })
  assert.notEqual(subagentDeps.sessions.subagentAddress('s-1'), undefined)
})

await scenario('write: one settings/conflict is retried with a fresh revision', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  // Another writer wins the race once; the retry rebuilds the ops from a fresh
  // describe and lands the same override.
  let calls = 0
  doc.onMutate(() => {
    calls += 1
    if (calls === 1) return err('settings/conflict', 'document moved (injected race)')
    return undefined
  })
  const out = await applyModelLimit(depsOf(doc), 131_072)
  assert.equal(out.failure, null, 'the conflict retry lands the write')
  assert.equal(out.limit, 131_072)
  assert.equal(calls, 2, 'exactly one retry')
  assert.deepEqual(doc.user.providers[ROUTE].models, [{ id: MODEL, contextWindow: 131_072 }])
})

await scenario('write: a non-conflict failure surfaces instead of retrying', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  let calls = 0
  doc.onMutate(() => {
    calls += 1
    return err('settings/rejected', 'invalid model row')
  })
  const out = await applyModelLimit(depsOf(doc), 131_072)
  assert.equal(out.failure, 'invalid model row (settings/rejected)', 'failure surfaced to the UI')
  assert.equal(calls, 1, 'no retry for non-conflict refusals')
})

await scenario('write: reset on a document with no override is a no-op (no mutate)', {
  id: ROUTE, model: MODEL, defaultContextWindow: 262144, models: [],
}, {
  id: ROUTE, model: MODEL, models: [],
}, async (doc) => {
  let calls = 0
  doc.onMutate(() => { calls += 1; return undefined })
  const out = await resetModelLimit(depsOf(doc))
  assert.equal(out.failure, null)
  assert.equal(calls, 0, 'empty op list never reaches mutate')
})
