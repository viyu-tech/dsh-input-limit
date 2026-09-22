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

/** Required services: the seat's slot registry, locale, the remote face, and sessions. */
export const inject = ['slots', 'locale', 'remote', 'sessions']

/**
 * Client plugin body: register the input-limit chip into the composer's right
 * tool-row seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'input-limit: dictionaries')

  // The injected services, read structurally so the plugin never imports
  // harness types into its runtime bundle.
  const remote = (ctx as unknown as { remote: Remote }).remote
  const sessions = (ctx as unknown as { sessions: SessionsLike }).sessions

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
