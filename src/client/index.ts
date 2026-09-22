/**
 * Input-limit plugin, browser half: occupies the composer's
 * `conversation.input.right` list seat with a small chip that shows the
 * current model's input limit (context window) and writes a per-model override
 * to the provider's settings section. All data flows through the rc.2 client
 * wire face (`ctx.remote` Typert namespaces and the `ctx.sessions` object
 * layer); the forwarded `settings/document-updated` event and the session's
 * `modelSelection` projection refresh open chips.
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputLimitInjected } from './contract.ts'
import { applyModelLimit, readLimit, resetModelLimit } from './provider.ts'
import type { Remote, SessionsLike } from './wire.ts'
import { InputLimitChip } from './InputLimitChip.tsx'
import { en, zh, type InputLimitKey } from './locales.ts'

export type { InputLimitKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer input-limit control's copy. */
    inputLimit: InputLimitKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'inputLimit'

export const name = 'dsh-input-limit'

/**
 * Required services: the seat's slot registry, locale, the remote face, the
 * Typert remote sub-namespaces this plugin reads through, and sessions.
 *
 * `remote.settings` / `remote.session` must be listed explicitly — Cordis
 * resolves them through its traceable context proxy (`reflect.props['remote.x']`),
 * so merely injecting `remote` still throws "cannot get property remote.settings
 * without inject" when the faces are accessed below.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'remote.settings', 'sessions']

/**
 * Client plugin body: register the input-limit chip into the composer's right
 * tool-row seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'input-limit: dictionaries')

  // Read the services through `ctx.get` (the global service store — no
  // inject/fiber path) and detach the concrete faces NOW, inside the plugin
  // fiber: the component-time callbacks run in the seat's fiber, where
  // `ctx.remote.session` and friends would hit Cordis's traceable context
  // proxy and fail with "cannot get property remote.session without inject".
  const rawRemote = ctx.get('remote') as unknown as {
    settings: Remote['settings']
    session: Remote['session']
    $on: Remote['$on']
  }
  const sessions = ctx.get('sessions') as unknown as SessionsLike
  const remote: Remote = {
    settings: rawRemote.settings,
    session: rawRemote.session,
    $on: (event, listener) => rawRemote.$on(event, listener),
  }

  // One shared refresh fan: any settings-document change reloads every open
  // pill, so an edit made on the Settings page appears without remounting.
  const listeners = new Set<() => void>()
  ctx.effect(() => remote.$on('settings/document-updated', () => {
    for (const listener of [...listeners]) listener()
  }), 'input-limit: settings refresh')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'input-limit',
    locale: NS,
    inject: (sessionId: SessionId): InputLimitInjected => {
      const subagent = sessions.subagentAddress(sessionId) !== undefined
      const deps = { remote, sessions, sessionId }
      return {
        available: !subagent,
        read: () => readLimit(deps),
        write: async (limit) => (await applyModelLimit(deps, limit)).failure,
        reset: async () => (await resetModelLimit(deps)).failure,
        subscribe: (listener) => {
          listeners.add(listener)
          // When this session's model selection changes, reload this pill (the
          // settings echo already covers document edits).
          const projection = sessions.binding(sessionId)?.session.projections.faceOf('modelSelection')
          const offProjection = projection?.subscribe?.(() => listener())
          return () => {
            listeners.delete(listener)
            offProjection?.()
          }
        },
      }
    },
  }, InputLimitChip))
}
