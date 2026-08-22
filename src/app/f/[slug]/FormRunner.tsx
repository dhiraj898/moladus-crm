'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { FormField } from '@/lib/supabase/types'
import { useFormNav } from '@/features/form-engine/useFormNav'
import type { Answer } from '@/features/form-engine/visibility'

/**
 * One-at-a-time public form runner (spec §5; plan Task 6.3).
 *
 * - One field per screen with a progress bar over the *visible* fields.
 * - Enter advances; Backspace on an empty field goes back; Back button.
 * - Statement + Yes/No fields auto-advance.
 * - Conditional navigation: hidden fields are skipped (via `useFormNav`).
 * - hCaptcha widget on the final step; POSTs `{ form_id, answers,
 *   captcha_token }` to the ingest endpoint and redirects to the returned
 *   payment link.
 *
 * Field definitions arrive fully rendered from the server — this component
 * never fetches config from the browser.
 */

interface FormRunnerProps {
  formId: string
  fields: FormField[]
  welcomeMessage: string | null
  submitLabel: string
  hcaptchaSiteKey: string
  ingestUrl: string
}

/** Minimal shape of the hCaptcha explicit-render API we use. */
interface HCaptchaApi {
  render: (
    container: HTMLElement,
    params: {
      sitekey: string
      theme?: string
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    }
  ) => string
  reset: (widgetId?: string) => void
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi
    onHCaptchaLoad?: () => void
  }
}

const HCAPTCHA_SRC =
  'https://js.hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaLoad'

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
  hcaptchaSiteKey,
  ingestUrl,
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

  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const captchaRef = useRef<HTMLDivElement | null>(null)
  const captchaWidgetId = useRef<string | null>(null)

  // Clear the transient field error whenever the field changes.
  useEffect(() => {
    setFieldError(null)
  }, [currentIndex])

  // Autofocus the text input of the current field for keyboard-first flow.
  useEffect(() => {
    inputRef.current?.focus()
  }, [currentIndex])

  // ---- hCaptcha (final step only) --------------------------------------
  const captchaRequired = hcaptchaSiteKey.length > 0

  const renderCaptcha = useCallback(() => {
    if (!captchaRequired || !window.hcaptcha || !captchaRef.current) return
    if (captchaWidgetId.current) return // already rendered
    captchaWidgetId.current = window.hcaptcha.render(captchaRef.current, {
      sitekey: hcaptchaSiteKey,
      theme: 'dark',
      callback: (token: string) => setCaptchaToken(token),
      'expired-callback': () => setCaptchaToken(null),
      'error-callback': () => setCaptchaToken(null),
    })
  }, [captchaRequired, hcaptchaSiteKey])

  // Load the hCaptcha script once, when the last step is reached.
  useEffect(() => {
    if (!isLast || !captchaRequired) return
    if (window.hcaptcha) {
      renderCaptcha()
      return
    }
    window.onHCaptchaLoad = renderCaptcha
    if (!document.querySelector(`script[src="${HCAPTCHA_SRC}"]`)) {
      const script = document.createElement('script')
      script.src = HCAPTCHA_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  }, [isLast, captchaRequired, renderCaptcha])

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
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        payment_link?: string
        error?: string
      } | null

      if (!res.ok || !data?.success || !data.payment_link) {
        setSubmitError(
          data?.error ??
            'Something went wrong submitting your enrollment. Please try again.'
        )
        setSubmitting(false)
        if (captchaRequired && captchaWidgetId.current && window.hcaptcha) {
          window.hcaptcha.reset(captchaWidgetId.current)
          setCaptchaToken(null)
        }
        return
      }
      // Success — hand off to the hosted payment link.
      window.location.href = data.payment_link
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

          {/* hCaptcha widget on the final step */}
          {isLast && captchaRequired ? (
            <div ref={captchaRef} className="mt-6" />
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

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  )
}
