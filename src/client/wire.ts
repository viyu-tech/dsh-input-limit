/**
 * Structural types for the rc.2 client wire surface this plugin reads and
 * writes through: the Typert `ctx.remote` namespaces (`settings`, `session`)
 * and the `ctx.sessions` object layer. They mirror the generated declarations
 * of the published 0.1.5-rc.2 packages so the plugin compiles standalone
 * without importing harness packages into its runtime bundle.
 */

/** One generated Remote call result; the error branch carries the failure code. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** A provider/model selection recorded in the session's durable fold. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
}

/** Durable per-session model-selection projection (the `modelSelection` face). */
export interface ModelSelectionProjection {
  readonly lastUsed: ModelSelection | null
  readonly next: ModelSelection | null
}

/** Host-generation model catalog backing every session's selector. */
export interface ModelCatalog {
  readonly default: ModelSelection | null
  readonly routableProviders: readonly string[]
}

/** The `emitted` settings view for every registered namespace (redacted). */
export interface SettingsNamespaceView {
  readonly ns: string
  readonly value: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly applies: 'live' | 'restart'
  readonly revision: number
}

/** `ctx.remote.settings.describe()` result: deployment writability + one view per namespace. */
export interface SettingsDescribeValue {
  readonly writable: boolean
  readonly hasDocument: boolean
  readonly namespaces: readonly SettingsNamespaceView[]
}

/** One path-addressed settings write (`set` creates intermediate objects; `unset` removes). */
export type SettingsPathOpView =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** The session's durable `modelSelection` projection face (an observable), read structurally. */
export interface ModelProjectionFace {
  readonly next?: ModelSelection | null
  readonly lastUsed?: ModelSelection | null
  readonly subscribe?: (listener: () => void) => () => void
}

/** The `ctx.remote` services this plugin needs. */
export interface Remote {
  readonly settings: {
    describe(): Promise<RemoteResult<SettingsDescribeValue>>
    mutate(ns: string, ops: readonly SettingsPathOpView[], expectedRevision: number | undefined): Promise<RemoteResult<SettingsNamespaceView>>
  }
  readonly session: {
    modelCatalog(): Promise<RemoteResult<ModelCatalog>>
  }
  $on(event: string, listener: (...args: unknown[]) => void): () => void
}

/** The subset of `ctx.sessions` this plugin needs for one seat. */
export interface SessionsLike {
  subagentAddress(id: string): unknown
  binding(id: string): {
    readonly session: {
      readonly projections: {
        faceOf(key: string): ModelProjectionFace
      }
    }
  } | undefined
}

/** Everything the data layer needs to address one session's model settings. */
export interface ProviderDeps {
  readonly remote: Remote
  readonly sessions: SessionsLike
  readonly sessionId: string
}
