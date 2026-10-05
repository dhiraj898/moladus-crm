'use client'

import 'altcha'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { FormField } from '@/lib/supabase/types'
import { useFormNav } from '@/features/form-engine/useFormNav'
import { formatMoney } from '@/features/form-engine/estimate'
import type { Answer } from '@/features/form-engine/visibility'

/**
 * One-at-a-time public form runner (spec §5; plan Task 6.3).
 *
 * - One field per screen with a progress bar over the *visible* fields.
 * - Enter advances; Backspace on an empty field goes back; Back button.
 * - Statement + Yes/No fields auto-advance.
 * - Conditional navigation: hidden fields are skipped (via `useFormNav`).
 * - Altcha proof-of-work widget on the final step; POSTs `{ form_id, answers,
 *   captcha_token }` to the ingest endpoint and redirects to the returned
 *   payment link.
 *
 * Field definitions arrive fully rendered from the server — this component
 * never fetches config from the browser.
 */

/**
 * An offered product, as computed server-side in `PublicFormPage` (plan Task
 * 5.1). `estimate` is a display-only per-item preview; it is `null` when the
 * form opts out of showing prices (`hide_price`).
 */
export interface ProductOffering {
  id: string
  name: string
  description: string | null
  is_bundle: boolean
  estimate: { total: number; gstRate: number; currency: string } | null
}

interface FormRunnerProps {
  formId: string
  fields: FormField[]
  welcomeMessage: string | null
  submitLabel: string
  captchaEnabled: boolean
  ingestUrl: string
  products: ProductOffering[]
  hidePrice: boolean
}

/** True when a value counts as answered (for required validation). */
function hasValue(value: Answer): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function FormRunner({
  formId,
  fields,
  welcomeMessage,
  submitLabel,
  captchaEnabled,
  ingestUrl,
  products,
  hidePrice,
}: FormRunnerProps) {
  const nav = useFormNav(fields)
  const {
    answers,
    current,
    currentIndex,
    totalVisible,
    isFirst,
    isLast,
    direction,
    setAnswer,
    next,
    back,
    setAnswerAndAdvance,
  } = nav

  // ---- selection-first cart (plan Task 5.2) ----------------------------
  // The customer picks one or more offered products before the field wizard.
  // When nothing is offered we skip the gate and reveal the wizard directly.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionDone, setSelectionDone] = useState(() => products.length === 0)

  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const captchaRef = useRef<HTMLDivElement | null>(null)

  // Clear the transient field error whenever the field changes.
  useEffect(() => {
    setFieldError(null)
  }, [currentIndex])

  // Autofocus the text input of the current field for keyboard-first flow.
  useEffect(() => {
    inputRef.current?.focus()
  }, [currentIndex])

  // ---- Altcha proof-of-work (final step only) --------------------------
  const captchaRequired = captchaEnabled

  // The `altcha` custom element (registered by `import 'altcha'`) fetches a
  // challenge from `challengeurl`, solves it in a worker, and emits a bubbling
  // `statechange` event carrying the base64 solution `payload` once verified.
  // We capture that payload into `captchaToken` (and clear it on any non-
  // verified state) so submit can gate on it and POST it as `captcha_token`.
  useEffect(() => {
    const container = captchaRef.current
    if (!isLast || !captchaRequired || !container) return

    const onStateChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{ payload?: string; state?: string }>
      ).detail
      setCaptchaToken(
        detail?.state === 'verified' && detail.payload ? detail.payload : null
      )
    }

    container.addEventListener('statechange', onStateChange)
    return () => container.removeEventListener('statechange', onStateChange)
  }, [isLast, captchaRequired])

  // ---- validation ------------------------------------------------------
  const validateCurrent = useCallback((): boolean => {
    if (!current) return true
    if (current.field_type === 'statement') return true
    const value = answers[current.key]

    if (current.required && !hasValue(value)) {
      setFieldError('This field is required.')
      return false
    }
    if (
      current.field_type === 'email' &&
      hasValue(value) &&
      !EMAIL_RE.test(String(value))
    ) {
      setFieldError('Enter a valid email address.')
      return false
    }
    setFieldError(null)
    return true
  }, [current, answers])

  // ---- submission ------------------------------------------------------
  const submit = useCallback(async () => {
    if (!validateCurrent()) return
    if (captchaRequired && !captchaToken) {
      setSubmitError('Please complete the verification challenge.')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: formId,
          answers,
          captcha_token: captchaToken,
          selected_products: selectedIds,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        payment_link?: string | null
        error?: string
      } | null

      if (!res.ok || !data?.success) {
        setSubmitError(
          data?.error ??
            'Something went wrong submitting your enrollment. Please try again.'
        )
        setSubmitting(false)
        if (captchaRequired) {
          // Re-arm the widget so the used solution isn't replayed on retry.
          captchaRef.current?.querySelector('altcha-widget')?.reset()
          setCaptchaToken(null)
        }
        return
      }
      if (typeof data.payment_link === 'string' && data.payment_link.length > 0) {
        // Success — hand off to the hosted payment link.
        window.location.href = data.payment_link
        return
      }
      // Success routed to a no-payment stage (e.g. "Call Requested"): the server
      // committed the submission but minted no link. Show a confirmation panel
      // instead of the payment redirect.
      setConfirmed(true)
    } catch {
      setSubmitError('Network error. Check your connection and try again.')
      setSubmitting(false)
    }
  }, [
    validateCurrent,
    captchaRequired,
    captchaToken,
    ingestUrl,
    formId,
    answers,
    selectedIds,
  ])

  // ---- navigation helpers ---------------------------------------------
  const advance = useCallback(() => {
    if (!validateCurrent()) return
    if (isLast) {
      void submit()
      return
    }
    next()
  }, [validateCurrent, isLast, submit, next])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Enter advances (Shift+Enter allowed for multi-line long_text).
      if (e.key === 'Enter' && !(e.shiftKey && current?.field_type === 'long_text')) {
        e.preventDefault()
        advance()
        return
      }
      // Backspace on an empty field steps back.
      if (
        e.key === 'Backspace' &&
        !isFirst &&
        current &&
        !hasValue(answers[current.key])
      ) {
        e.preventDefault()
        back()
      }
    },
    [advance, back, current, answers, isFirst]
  )

  // ---- render ----------------------------------------------------------
  // Confirmation state: the submission succeeded but routed to a no-payment
  // stage, so there is no hosted payment link to redirect to.
  if (confirmed) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-[520px] text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Enrollment received
          </p>
          <h2 className="mt-4 text-2xl font-extrabold tracking-[-0.02em]">
            Thanks — we’ve got your details
          </h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-dim">
            Someone from the team will be in touch shortly on WhatsApp. You can
            safely close this page.
          </p>
        </div>
      </div>
    )
  }

  // Selection-first gate: pick products before the field wizard is revealed.
  if (!selectionDone) {
    return (
      <ProductSelection
        products={products}
        hidePrice={hidePrice}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        welcomeMessage={welcomeMessage}
        onContinue={() => setSelectionDone(true)}
      />
    )
  }

  if (totalVisible === 0 || !current) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20 text-center">
        <p className="text-sm text-dim">This form has no questions yet.</p>
      </div>
    )
  }

  const progress = ((currentIndex + 1) / totalVisible) * 100
  const enterClass =
    direction === 'back' ? 'fe-enter-back' : 'fe-enter-forward'

  return (
    <div className="flex flex-1 flex-col">
      {/* Progress bar + counter */}
      <div className="px-6 pt-4">
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="tabular-nums text-xs font-medium text-dim">
            {currentIndex + 1} of {totalVisible}
          </span>
        </div>
      </div>

      {/* Field stage */}
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div
          key={currentIndex}
          className={`w-full max-w-[560px] ${enterClass}`}
          onKeyDown={handleKeyDown}
        >
          {currentIndex === 0 && welcomeMessage ? (
            <p className="mb-6 text-sm leading-[1.7] text-dim">
              {welcomeMessage}
            </p>
          ) : null}

          <FieldView
            field={current}
            value={answers[current.key]}
            setAnswer={setAnswer}
            onAutoAdvance={(v) =>
              isLast ? setAnswer(current.key, v) : setAnswerAndAdvance(v)
            }
            isLast={isLast}
            inputRef={inputRef}
          />

          {fieldError ? (
            <p className="mt-3 text-sm text-red" role="alert">
              {fieldError}
            </p>
          ) : null}

          {/* Altcha proof-of-work widget on the final step */}
          {isLast && captchaRequired ? (
            <div ref={captchaRef} className="mt-6">
              <altcha-widget
                challengeurl="/api/altcha/challenge"
                name="captcha_token"
                theme="dark"
              />
            </div>
          ) : null}

          {submitError ? (
            <p className="mt-4 text-sm text-red" role="alert">
              {submitError}
            </p>
          ) : null}

          {/* Controls */}
          <div className="mt-8 flex items-center gap-3">
            {!isFirst ? (
              <button
                type="button"
                onClick={back}
                disabled={submitting}
                className="rounded-[8px] border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-faint disabled:opacity-50"
              >
                Back
              </button>
            ) : null}

            {current.field_type === 'yes_no' && !isLast ? null : (
              <button
                type="button"
                onClick={advance}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-[8px] bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Spinner />
                    Submitting…
                  </>
                ) : isLast ? (
                  submitLabel
                ) : current.field_type === 'statement' ? (
                  'Continue'
                ) : (
                  'OK'
                )}
              </button>
            )}
            {!isLast && current.field_type !== 'statement' ? (
              <span className="hidden text-xs text-faint sm:inline">
                press Enter ↵
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

interface FieldViewProps {
  field: FormField
  value: Answer
  setAnswer: (key: string, value: Answer) => void
  onAutoAdvance: (value: Answer) => void
  isLast: boolean
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
}

const INPUT_CLASS =
  'w-full rounded-[10px] border border-line bg-surface px-4 py-3 text-[15px] text-text placeholder:text-faint outline-none transition-colors focus:border-accent'

function FieldView({
  field,
  value,
  setAnswer,
  onAutoAdvance,
  isLast,
  inputRef,
}: FieldViewProps) {
  const label = (
    <div className="mb-4">
      <label
        htmlFor={`field-${field.key}`}
        className="block text-xl font-bold tracking-[-0.01em]"
      >
        {field.label}
        {field.required && field.field_type !== 'statement' ? (
          <span className="ml-1 text-accent">*</span>
        ) : null}
      </label>
    </div>
  )

  switch (field.field_type) {
    case 'statement':
      return (
        <div>
          <h2 className="text-xl font-bold tracking-[-0.01em]">{field.label}</h2>
          {field.placeholder ? (
            <p className="mt-3 text-[15px] leading-[1.7] text-dim">
              {field.placeholder}
            </p>
          ) : null}
        </div>
      )

    case 'long_text':
      return (
        <>
          {label}
          <textarea
            id={`field-${field.key}`}
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder ?? ''}
            rows={4}
            onChange={(e) => setAnswer(field.key, e.target.value)}
            className={`${INPUT_CLASS} resize-none`}
          />
        </>
      )

    case 'dropdown':
      return (
        <>
          {label}
          <select
            id={`field-${field.key}`}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setAnswer(field.key, e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Select…</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </>
      )

    case 'radio':
      return (
        <>
          {label}
          <div className="flex flex-col gap-2">
            {(field.options ?? []).map((opt) => {
              const selected = value === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    isLast
                      ? setAnswer(field.key, opt.value)
                      : onAutoAdvance(opt.value)
                  }
                  className={`rounded-[10px] border px-4 py-3 text-left text-[15px] transition-colors ${
                    selected
                      ? 'border-accent bg-surface2 text-text'
                      : 'border-line bg-surface text-text hover:border-faint'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </>
      )

    case 'checkbox_group': {
      const selected = Array.isArray(value) ? value : []
      const toggle = (optValue: string) => {
        const nextValue = selected.includes(optValue)
          ? selected.filter((v) => v !== optValue)
          : [...selected, optValue]
        setAnswer(field.key, nextValue)
      }
      return (
        <>
          {label}
          <div className="flex flex-col gap-2">
            {(field.options ?? []).map((opt) => {
              const isOn = selected.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={`flex items-center gap-3 rounded-[10px] border px-4 py-3 text-left text-[15px] transition-colors ${
                    isOn
                      ? 'border-accent bg-surface2 text-text'
                      : 'border-line bg-surface text-text hover:border-faint'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[6px] border text-xs ${
                      isOn
                        ? 'border-accent bg-accent text-white'
                        : 'border-faint'
                    }`}
                  >
                    {isOn ? '✓' : ''}
                  </span>
                  {opt.label}
                </button>
              )
            })}
          </div>
        </>
      )
    }

    case 'yes_no':
      return (
        <>
          {label}
          <div className="flex gap-3">
            {[
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ].map((opt) => {
              const selected = value === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    isLast
                      ? setAnswer(field.key, opt.value)
                      : onAutoAdvance(opt.value)
                  }
                  className={`flex-1 rounded-[12px] border px-4 py-6 text-base font-semibold transition-colors ${
                    selected
                      ? 'border-accent bg-surface2 text-text'
                      : 'border-line bg-surface text-text hover:border-faint'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </>
      )

    case 'number':
    case 'phone':
    case 'email':
    case 'date':
    case 'short_text':
    default: {
      const inputType =
        field.field_type === 'number'
          ? 'number'
          : field.field_type === 'phone'
            ? 'tel'
            : field.field_type === 'email'
              ? 'email'
              : field.field_type === 'date'
                ? 'date'
                : 'text'
      return (
        <>
          {label}
          <input
            id={`field-${field.key}`}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={inputType}
            inputMode={
              field.field_type === 'number'
                ? 'numeric'
                : field.field_type === 'phone'
                  ? 'tel'
                  : undefined
            }
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder ?? ''}
            onChange={(e) => setAnswer(field.key, e.target.value)}
            className={INPUT_CLASS}
          />
        </>
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Selection-first cart (plan Task 5.2)
// ---------------------------------------------------------------------------

interface ProductSelectionProps {
  products: ProductOffering[]
  hidePrice: boolean
  selectedIds: string[]
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>
  welcomeMessage: string | null
  onContinue: () => void
}

function ProductSelection({
  products,
  hidePrice,
  selectedIds,
  setSelectedIds,
  welcomeMessage,
  onContinue,
}: ProductSelectionProps) {
  const singles = products.filter((p) => !p.is_bundle)
  const bundles = products.filter((p) => p.is_bundle)

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    )

  // Running total over selected items that carry a price estimate. Hidden
  // entirely when the form opts out of showing prices.
  const selected = products.filter((p) => selectedIds.includes(p.id))
  const currency = selected.find((p) => p.estimate)?.estimate?.currency ?? 'INR'
  const runningTotal = selected.reduce(
    (sum, p) => sum + (p.estimate?.total ?? 0),
    0
  )
  const showTotal = !hidePrice && selected.length > 0

  const canContinue = selectedIds.length > 0

  const card = (p: ProductOffering) => {
    const isOn = selectedIds.includes(p.id)
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => toggle(p.id)}
        aria-pressed={isOn}
        className={`flex w-full items-start gap-3 rounded-[12px] border px-4 py-4 text-left transition-colors ${
          isOn
            ? 'border-accent bg-surface2'
            : 'border-line bg-surface hover:border-faint'
        }`}
      >
        <span
          aria-hidden
          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[6px] border text-xs ${
            isOn ? 'border-accent bg-accent text-white' : 'border-faint'
          }`}
        >
          {isOn ? '✓' : ''}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-[-0.01em]">
            {p.name}
          </span>
          {p.description ? (
            <span className="mt-1 block text-sm leading-[1.6] text-dim">
              {p.description}
            </span>
          ) : null}
        </span>
        {!hidePrice && p.estimate ? (
          <span className="flex-shrink-0 text-right">
            <span className="block tabular-nums text-[15px] font-bold tracking-[-0.01em]">
              {formatMoney(p.estimate.total, p.estimate.currency)}
            </span>
            <span className="block text-xs text-dim">
              {p.estimate.gstRate > 0
                ? `incl. ${p.estimate.gstRate}% GST`
                : 'no GST'}
            </span>
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-6 py-10">
        <div className="mx-auto w-full max-w-[560px]">
          {welcomeMessage ? (
            <p className="mb-6 text-sm leading-[1.7] text-dim">
              {welcomeMessage}
            </p>
          ) : null}

          <h2 className="text-xl font-bold tracking-[-0.01em]">
            What would you like to enroll in?
          </h2>
          <p className="mt-1 text-sm text-dim">Select one or more to continue.</p>

          {singles.length > 0 ? (
            <div className="mt-6 flex flex-col gap-2">
              {singles.map(card)}
            </div>
          ) : null}

          {bundles.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                Bundles
              </h3>
              <div className="mt-3 flex flex-col gap-2">{bundles.map(card)}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Sticky running total + continue */}
      <div className="sticky bottom-0 border-t border-line bg-surface/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[560px] items-center justify-between gap-4">
          {showTotal ? (
            <div className="min-w-0">
              <div className="text-xs text-dim">Total</div>
              <div className="tabular-nums text-lg font-extrabold tracking-[-0.01em]">
                {formatMoney(runningTotal, currency)}
              </div>
            </div>
          ) : (
            <div className="min-w-0 text-sm text-dim">
              {selectedIds.length > 0
                ? `${selectedIds.length} selected`
                : 'Nothing selected yet'}
            </div>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-[8px] bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  )
}
