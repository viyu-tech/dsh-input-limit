/**
 * Client-side data access for the input-limit control. Everything rides the
 * 0.1.5-rc.2 client wire face — the Typert `ctx.remote` namespaces and the
 * `ctx.sessions` object layer — so the pill both reads and writes through the
 * same Remote calls the Settings page uses. No custom host code.
 */

import type {
  ModelProjectionFace, ModelSelection, ProviderDeps, RemoteResult,
  SettingsNamespaceView, SettingsPathOpView,
} from './wire.ts'

/** One resolved model-input-limit snapshot for the composer seat. */
export interface LimitRead {
  /** Whether an editable seat exists (a configurable provider + a model selection). */
  editable: boolean
  /** Whether the settings document accepts writes (read-only profiles disable saving). */
  writable: boolean
  /** Settings namespace the provider's section lives under (`llm-pi-ai`, `llm-deepseek`, …). */
  namespace: string
  /** Path from the section root to the provider profile object. */
  profilePath: readonly string[]
  /** Path from the section root to the provider's `models` array. */
  modelsPath: readonly string[]
  /** Provider route id. */
  provider: string
  /** Current model id. */
  model: string
  /** Exact per-model context window in the effective layer, when declared. */
  limit: number | undefined
  /** The provider route's default context-window fallback, when declared. */
  defaultLimit: number | undefined
  /** Settings document revision to pass back on a write. */
  revision: number | undefined
}

/** Outcome of one write attempt; `failure` is a non-null user-visible message when the write did not land. */
export interface LimitWrite {
  failure: string | null
  /** The limit that now applies, when the write landed. */
  limit: number | undefined
}

/** Serialize a failed Remote result into a user-visible line (never localized). */
function rpcFailure(error: { message: string; code: string }): string {
  return `${error.message} (${error.code})`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberAt(value: unknown, path: readonly string[]): number | undefined {
  let node: unknown = value
  for (const segment of path) {
    if (!isRecord(node)) return undefined
    node = node[segment]
  }
  return typeof node === 'number' ? node : undefined
}

function arrayAt(value: unknown, path: readonly string[]): Array<Record<string, unknown>> | undefined {
  let node: unknown = value
  for (const segment of path) {
    if (!isRecord(node)) return undefined
    node = node[segment]
  }
  return Array.isArray(node) ? node.filter(isRecord) : undefined
}

/** The namespace whose resolved `providers` dict contains `providerRoute`. */
function namespaceForRoute(
  view: { namespaces: readonly SettingsNamespaceView[] },
  providerRoute: string,
): SettingsNamespaceView | undefined {
  return view.namespaces.find(entry => {
    const providers = isRecord(entry.value) ? entry.value.providers : undefined
    return isRecord(providers) && providers[providerRoute] !== undefined
  })
}

function modelsOf(namespace: SettingsNamespaceView | undefined, modelsPath: readonly string[]): Array<Record<string, unknown>> {
  if (namespace === undefined) return []
  return arrayAt(namespace.value, modelsPath) ?? []
}

/** The current model selection for one session: the durable fold, then the host catalog default. */
async function currentSelection(deps: ProviderDeps): Promise<ModelSelection | null> {
  const binding = deps.sessions.binding(deps.sessionId)
  const projected: ModelProjectionFace | undefined = binding?.session.projections.faceOf('modelSelection')
  const durable = projected?.next ?? projected?.lastUsed ?? null
  if (durable !== null && durable !== undefined) return durable
  const catalog = await deps.remote.session.modelCatalog()
  if (!catalog.ok) return null
  return catalog.value.default
}

/**
 * Resolve the session's current model to its configurable provider, read the
 * effective per-model context window, and report its settings address.
 * @param deps - the wire faces and the owning session.
 * @returns the snapshot; `editable: false` means the seat should render nothing.
 */
export async function readLimit(deps: ProviderDeps): Promise<LimitRead> {
  const current = await currentSelection(deps)
  if (current === null) {
    return deadRead(false, '', '')
  }

  const describe = await deps.remote.settings.describe()
  if (!describe.ok) throw new Error(rpcFailure(describe.error))
  const view = describe.value
  const namespace = namespaceForRoute(view, current.provider)
  if (namespace === undefined) {
    return deadRead(view.writable, current.provider, current.model)
  }

  const profilePath: readonly string[] = ['providers', current.provider]
  const modelsPath: readonly string[] = [...profilePath, 'models']
  const models = modelsOf(namespace, modelsPath)
  const entry = models.find(row => stringOf(row.id) === current.model)
  const limit = typeof entry?.contextWindow === 'number' ? entry.contextWindow : undefined
  return {
    editable: true,
    writable: view.writable,
    namespace: namespace.ns,
    profilePath,
    modelsPath,
    provider: current.provider,
    model: current.model,
    limit,
    defaultLimit: numberAt(namespace.value, [...profilePath, 'defaultContextWindow'])
      ?? numberAt(namespace.base, [...profilePath, 'defaultContextWindow'])
      ?? numberAt(namespace.user, [...profilePath, 'defaultContextWindow']),
    revision: namespace.revision,
  }
}

/** A non-editable snapshot (no model, or a provider not present in any settings namespace). */
function deadRead(writable: boolean, provider: string, model: string): LimitRead {
  return {
    editable: false,
    writable,
    namespace: '',
    profilePath: [],
    modelsPath: [],
    provider,
    model,
    limit: undefined,
    defaultLimit: undefined,
    revision: undefined,
  }
}

/** The `models` array with the target row's `contextWindow` set to `limit` (row replaced, or appended when absent). */
function withModelLimit(
  models: Array<Record<string, unknown>>,
  model: string,
  limit: number,
): Array<Record<string, unknown>> {
  const index = models.findIndex(row => stringOf(row.id) === model)
  if (index >= 0) {
    const next = [...models]
    next[index] = { ...models[index], contextWindow: limit }
    return next
  }
  return [...models, { id: model, contextWindow: limit }]
}

/** Fresh describe + the target namespace's models/revision for a write, keyed by a prior read. */
async function freshWriteSection(
  deps: ProviderDeps,
  read: LimitRead,
): Promise<{ namespace: SettingsNamespaceView | undefined; models: Array<Record<string, unknown>> }> {
  const describe = await deps.remote.settings.describe()
  if (!describe.ok) throw new Error(rpcFailure(describe.error))
  const namespace = describe.value.namespaces.find(entry => entry.ns === read.namespace)
  return { namespace, models: modelsOf(namespace, read.modelsPath) }
}

/**
 * Persist a per-model context-window override to the provider's settings
 * section (materializing inherited rows, exactly like the built-in editor).
 * @param deps - the wire faces and the owning session.
 * @param limit - positive token count.
 * @returns the write outcome.
 */
export async function applyModelLimit(deps: ProviderDeps, limit: number): Promise<LimitWrite> {
  const read = await readLimit(deps)
  if (!read.editable) return { failure: 'model is not configurable in this deployment', limit: undefined }
  if (read.namespace === '') return { failure: 'settings namespace not found', limit: undefined }

  const { namespace, models } = await freshWriteSection(deps, read)
  if (namespace === undefined) return { failure: 'settings namespace not found', limit: undefined }

  const ops: SettingsPathOpView[] = [
    { op: 'set', path: [...read.modelsPath], value: withModelLimit(models, read.model, limit) },
  ]
  const result: RemoteResult<SettingsNamespaceView> = await deps.remote.settings.mutate(read.namespace, ops, namespace.revision)
  if (!result.ok) return { failure: rpcFailure(result.error), limit: undefined }
  return { failure: null, limit }
}

/**
 * Remove the current model's context-window override. The `models` array is
 * rewritten without the field, so the resolved value falls back to the
 * provider route's `defaultContextWindow` (or its inherited base value).
 * @param deps - the wire faces and the owning session.
 * @returns the write outcome.
 */
export async function resetModelLimit(deps: ProviderDeps): Promise<LimitWrite> {
  const read = await readLimit(deps)
  if (!read.editable) return { failure: 'model is not configurable in this deployment', limit: undefined }
  if (read.namespace === '') return { failure: 'settings namespace not found', limit: undefined }

  const describe = await deps.remote.settings.describe()
  if (!describe.ok) return { failure: rpcFailure(describe.error), limit: undefined }
  const namespace = describe.value.namespaces.find(entry => entry.ns === read.namespace)
  if (namespace === undefined) return { failure: 'settings namespace not found', limit: undefined }

  const userModels = arrayAt(namespace.user, read.modelsPath)
  if (userModels === undefined || userModels.length === 0) {
    // No user-owned override to remove; the provider default already applies.
    return { failure: null, limit: undefined }
  }
  if (!userModels.some(row => stringOf(row.id) === read.model)) {
    return { failure: null, limit: undefined }
  }
  const next = userModels.map(row => {
    if (stringOf(row.id) !== read.model) return row
    const { contextWindow: _dropped, ...rest } = row
    return rest
  })
  const ops: SettingsPathOpView[] = [{ op: 'set', path: [...read.modelsPath], value: next }]
  const result: RemoteResult<SettingsNamespaceView> = await deps.remote.settings.mutate(read.namespace, ops, namespace.revision)
  if (!result.ok) return { failure: rpcFailure(result.error), limit: undefined }
  return { failure: null, limit: undefined }
}
