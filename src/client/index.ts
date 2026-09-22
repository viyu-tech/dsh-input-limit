/**
 * Input-limit plugin, browser half: occupies the composer's
 * `conversation.input.right` list seat with a small chip that shows the
 * current model's input limit (context window) and writes a per-model override
 * to the provider's settings section. All data flows through the api-remotes
 * wire face (`ctx.connection.api`); the settings/document-updated forward
 * refreshes open chips.
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the remote Context merge (ctx.remote).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { InputLimitInjected } from './contract.ts'
import { applyModelLimit, readLimit, resetModelLimit } from './provider.ts'
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

/** Required services: the seat's slot registry, the locale and remote faces, the connection, and sessions. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions']

/**
 * Client plugin body: register the input-limit chip into the composer's right
 * tool-row seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'input-limit: dictionaries')

  // One shared refresh fan: any settings-document change reloads every open
  // pill, so an edit made on the Settings page appears without remounting.
  const listeners = new Set<() => void>()
  ctx.effect(() => ctx.remote.$on('settings/document-updated', () => {
    for (const listener of [...listeners]) listener()
  }), 'input-limit: settings refresh')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'input-limit',
    locale: NS,
    inject: (sessionId: SessionId): InputLimitInjected => {
      const connection = ctx.get('connection') as ConnectionHandle
      const api = connection.api
      const subagent = ctx.sessions.subagentAddress(sessionId) !== undefined
      return {
        available: !subagent,
        read: () => readLimit(api, sessionId),
        write: async (limit) => {
          const outcome = await applyModelLimit(api, sessionId, limit)
          return outcome.failure
        },
        reset: async () => {
          const outcome = await resetModelLimit(api, sessionId)
          return outcome.failure
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    },
  }, InputLimitChip))
}
