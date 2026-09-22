/**
 * Shared contract of the browser half: the injected business face the composer
 * seat hands to the chip, and the read snapshot it renders from.
 */

import type { LimitRead } from './provider.ts'

/** Injected business face of the composer input-limit seat. */
export interface InputLimitInjected {
  /** Whether this session supports model inspection (addressed subagent sessions do not). */
  available: boolean
  /**
   * Resolve the current model's effective input limit and its settings address.
   * @returns the read snapshot; `editable: false` means the seat should render nothing.
   */
  read: () => Promise<LimitRead>
  /**
   * Set the current model's context-window override and persist it to the
   * settings document.
   * @param limit - positive token count.
   * @returns a user-visible failure message, or `null` on success.
   */
  write: (limit: number) => Promise<string | null>
  /**
   * Remove the current model's context-window override, restoring the provider
   * default.
   * @returns a user-visible failure message, or `null` on success.
   */
  reset: () => Promise<string | null>
  /**
   * Register a refresh listener fired when the settings document changes.
   * @param listener - reload callback.
   * @returns the unsubscriber.
   */
  subscribe: (listener: () => void) => () => void
}
