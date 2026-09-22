/**
 * Client-side data access for the input-limit control. Everything rides the
 * api-remotes wire face — no custom host code — so the pill both reads and
 * writes through the same typed RPCs the Settings page uses.
 */

import type {
  IApiClient, RpcResult, SessionId, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'

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

/** Serialize a failed RPC result into a user-visible line (never localized). */
function rpcFailure(result: Extract<RpcResult<unknown>, { ok: false }>): string {
  return `${result.error.message} (${result.error.code})`
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

function namespaceOf(view: { namespaces: SettingsNamespaceView[] }, ns: string): SettingsNamespaceView | undefined {
  return view.namespaces.find(entry => entry.ns === ns)
}

function modelsOf(namespace: SettingsNamespaceView | undefined, modelsPath: readonly string[]): Array<Record<string, unknown>> {
  if (namespace === undefined) return []
  return arrayAt(namespace.value, modelsPath) ?? []
}

/**
 * Resolve the session's current model to its configurable provider, read the
 * effective per-model context window, and report its settings address.
 * @param api - the connected wire face.
 * @param sessionId - owning session.
 * @returns the snapshot.
 */
export async function readLimit(api: IApiClient, sessionId: SessionId): Promise<LimitRead> {
  const directory = await api.sessions.models({ sessionId })
  if (!directory.result.ok) throw new Error(rpcFailure(directory.result))
  const current = directory.result.value.current

  const directoryResult = await api.llm.providers({})
  if (!directoryResult.result.ok) throw new Error(rpcFailure(directoryResult.result))
  const provider = directoryResult.result.value.providers.find(entry => entry.provider === current.provider)
  if (provider === undefined || provider.settingsNs === '') {
    return {
      editable: false,
      writable: false,
      namespace: '',
      profilePath: [],
      modelsPath: [],
      provider: current.provider,
      model: current.model,
      limit: undefined,
      defaultLimit: undefined,
      revision: undefined,
    }
  }

  const describe = await api.settings.describe({})
  if (!describe.result.ok) throw new Error(rpcFailure(describe.result))
  const namespace = namespaceOf(describe.result.value, provider.settingsNs)
  const profilePath = provider.settingsPath
  const modelsPath = [...profilePath, 'models']
  const models = modelsOf(namespace, modelsPath)
  const entry = models.find(model => stringOf(model.id) === current.model)
  const limit = typeof entry?.contextWindow === 'number' ? entry.contextWindow : undefined
  return {
    editable: true,
    writable: describe.result.value.writable,
    namespace: provider.settingsNs,
    profilePath,
    modelsPath,
    provider: current.provider,
    model: current.model,
    limit,
    defaultLimit: numberAt(namespace?.value, [...profilePath, 'defaultContextWindow']),
    revision: namespace?.revision,
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

/** The settings namespace's `models` array plus its document revision, for a write. */
async function settingsModels(
  api: IApiClient,
  namespaceKey: string,
  modelsPath: readonly string[],
): Promise<{ models: Array<Record<string, unknown>>; revision: number | undefined }> {
  const describe = await api.settings.describe({})
  if (!describe.result.ok) throw new Error(rpcFailure(describe.result))
  const namespace = namespaceOf(describe.result.value, namespaceKey)
  return { models: modelsOf(namespace, modelsPath), revision: namespace?.revision }
}

/**
 * Persist a per-model context-window override to the provider's settings
 * section (materializing inherited rows, exactly like the built-in editor).
 * @param api - the connected wire face.
 * @param sessionId - owning session.
 * @param limit - positive token count.
 * @returns the write outcome.
 */
export async function applyModelLimit(api: IApiClient, sessionId: SessionId, limit: number): Promise<LimitWrite> {
  const read = await readLimit(api, sessionId)
  if (!read.editable) return { failure: 'model is not configurable in this deployment', limit: undefined }

  const { models, revision } = await settingsModels(api, read.namespace, read.modelsPath)
  const ops: SettingsPathOpView[] = [
    { op: 'set', path: [...read.modelsPath], value: withModelLimit(models, read.model, limit) },
  ]
  const result = await api.settings.mutate({
    ns: read.namespace,
    ops,
    ...revision === undefined ? {} : { expectedRevision: revision },
  })
  if (!result.result.ok) return { failure: rpcFailure(result.result), limit: undefined }
  return { failure: null, limit }
}

/**
 * Remove the current model's context-window override. With a user-owned
 * `models` array the row is restored to its base value when it has one,
 * otherwise the field is dropped so the provider default fallback applies.
 * @param api - the connected wire face.
 * @param sessionId - owning session.
 * @returns the write outcome.
 */
export async function resetModelLimit(api: IApiClient, sessionId: SessionId): Promise<LimitWrite> {
  const read = await readLimit(api, sessionId)
  if (!read.editable) return { failure: 'model is not configurable in this deployment', limit: undefined }

  const describe = await api.settings.describe({})
  if (!describe.result.ok) throw new Error(rpcFailure(describe.result))
  const namespace = namespaceOf(describe.result.value, read.namespace)
  const userModels = arrayAt(namespace?.user, read.modelsPath)
  if (userModels === undefined) {
    // No user-owned override to remove; the provider default already applies.
    return { failure: null, limit: read.limit }
  }
  const baseLimit = arrayAt(namespace?.base, read.modelsPath)
    ?.find(row => stringOf(row.id) === read.model)
  const baseValue = typeof baseLimit?.contextWindow === 'number' ? baseLimit.contextWindow : undefined
  const next = userModels.map(row => {
    if (stringOf(row.id) !== read.model) return row
    if (baseValue !== undefined) return { ...row, contextWindow: baseValue }
    const { contextWindow: _dropped, ...rest } = row
    return rest
  })
  const ops: SettingsPathOpView[] = [{ op: 'set', path: [...read.modelsPath], value: next }]
  const result = await api.settings.mutate({
    ns: read.namespace,
    ops,
    ...namespace?.revision === undefined ? {} : { expectedRevision: namespace.revision },
  })
  if (!result.result.ok) return { failure: rpcFailure(result.result), limit: undefined }
  return { failure: null, limit: baseValue }
}
