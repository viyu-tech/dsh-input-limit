/**
 * The composer-seat control: a small chip next to the model picker showing the
 * current model's input limit, opening a popover that writes a per-model
 * `contextWindow` override to the settings document.
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputLimitInjected } from './contract.ts'
import { formatCapacity, formatCompact, parseCapacity } from './capacity.ts'
import css from './InputLimitChip.module.css'

/** Full composer-seat component props: runtime share & injected face & the locale seat. */
export type InputLimitChipProps =
  PropsRuntime<'conversation.input.right'> & InjectFace<InputLimitInjected> & PropsLocale<'inputLimit'>

type View =
  | { status: 'idle' }
  | { status: 'ready'; read: Awaited<ReturnType<InputLimitInjected['read']>> }
  | { status: 'error'; message: string }

/** User-visible failure line from an unexpected rejection (never localized). */
function failureText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Renders the pill only when a readable limit exists for a configurable
 * provider; a click opens the popover whose save/reset write through the
 * injected wire face.
 */
export function InputLimitChip({
  sessionId, available, read, write, reset, subscribe, t,
}: InputLimitChipProps) {
  const [view, setView] = useState<View>({ status: 'idle' })
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    let cancelled = false
    const load = (): void => {
      if (!available) return
      read().then(
        (snapshot) => {
          if (cancelled || !alive.current) return
          setView(snapshot.editable && snapshot.writable
            ? { status: 'ready', read: snapshot }
            : { status: 'idle' })
        },
        (reason: unknown) => {
          if (cancelled || !alive.current) return
          console.warn('[dsh-input-limit] read failed:', reason)
          setView({ status: 'error', message: failureText(reason) })
        },
      )
    }
    const off = subscribe(load)
    load()
    return () => {
      cancelled = true
      off()
    }
  }, [sessionId, available, read, subscribe])

  if (view.status !== 'ready') return null
  const current = view.read
  // No numeric value at hand (neither an override nor a route default): render
  // the bare, clickable label — the point is to let the user set a limit.
  const compact = current.limit !== undefined
    ? formatCompact(current.limit)
    : current.defaultLimit !== undefined ? formatCompact(current.defaultLimit) : null
  const isDefault = current.limit === undefined

  const openPopover = (): void => {
    setOpen(true)
    setDraft(current.limit !== undefined ? formatCapacity(current.limit) : '')
    setError(null)
  }
  const close = (): void => { setOpen(false) }

  const afterCommit = (): void => {
    // The settings echo reloads the value; the pill label follows on its own.
    setOpen(false)
    setBusy(false)
  }

  const save = (): void => {
    const parsed = parseCapacity(draft)
    if (parsed === undefined || Number.isNaN(parsed) || parsed <= 0) {
      setError(t('error.invalid'))
      return
    }
    setBusy(true)
    setError(null)
    write(parsed).then((failure) => {
      if (!alive.current) return
      if (failure === null) afterCommit()
      else { setBusy(false); setError(failure) }
    }, (reason: unknown) => {
      if (!alive.current) return
      setBusy(false)
      setError(failureText(reason))
    })
  }

  const resetNow = (): void => {
    setBusy(true)
    setError(null)
    reset().then((failure) => {
      if (!alive.current) return
      if (failure === null) afterCommit()
      else { setBusy(false); setError(failure) }
    }, (reason: unknown) => {
      if (!alive.current) return
      setBusy(false)
      setError(failureText(reason))
    })
  }

  const label = compact !== null
    ? `${t('chip.label')} ${compact}${isDefault ? ` · ${t('chip.defaultTag')}` : ''}`
    : `${t('chip.label')} · ${t('chip.defaultTag')}`
  const title = `${t('chip.title')} — ${current.model}`

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={css.chip}
        title={title}
        aria-label={`${label}; ${t('chip.ariaAction')}`}
        aria-expanded={open}
        onClick={() => { open ? close() : openPopover() }}
      >
        {label}
      </button>
      {open && (
        <>
          <button type="button" className={css.backdrop} aria-hidden="true" tabIndex={-1} onClick={close} />
          <div className={css.popover} role="dialog" aria-label={t('popover.title')}>
            <div className={css.popTitle}>{t('popover.title')}</div>
            <div className={css.modelName}>{current.model}</div>
            <div className={css.popHint}>{t('popover.hint')}</div>
            <label className={css.fieldLabel}>
              <span>{t('field.label')}</span>
              <input
                className={css.field}
                autoFocus
                value={draft}
                placeholder={t('field.placeholder')}
                onChange={(event) => { setDraft(event.target.value); setError(null) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); save() }
                  if (event.key === 'Escape') close()
                }}
              />
            </label>
            {error !== null && <div className={css.error} role="alert">{error}</div>}
            <div className={css.actions}>
              <button type="button" className={css.secondary} onClick={close} disabled={busy}>{t('cancel')}</button>
              <button type="button" className={css.secondary} onClick={resetNow} disabled={busy}>{t('reset')}</button>
              <button type="button" className={css.primary} onClick={save} disabled={busy}>
                {busy ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  )
}
