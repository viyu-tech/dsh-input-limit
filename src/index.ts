/**
 * Host half of dsh-input-limit. The browser UI lives in `./client`; this
 * package's presence as a loader entry is what makes the Host serve the client
 * bundle and the browser execute it, so this half carries no behavior.
 */

export const name = 'dsh-input-limit'

export function apply(): void {
  // Intentionally empty: the entry exists to activate the browser half.
}
