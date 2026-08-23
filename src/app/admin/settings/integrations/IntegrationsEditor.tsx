'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SecretKey } from '@/lib/supabase/types'
import type { IntegrationStatus } from '@/features/integrations/queries'
import {
  setSecret,
  clearSecret,
  testRazorpay,
  testAiSensy,
  type ActionResult,
} from '@/features/integrations/actions'

/**
 * Integrations editor (Spec A, Task 4.1). One card per provider (Razorpay,
 * AiSensy). Each secret shows a masked status chip (Set (DB) / Set (env) / Not
 * set), a write-only password input with Save + Clear, and inline errors. A
 * Webhooks block per provider shows the inbound URL to register (with Copy), its
 * signing-secret field, and a Test button surfacing a green/red result.
 *
 * SECURITY: secret values are NEVER pre-filled or echoed — inputs start empty
 * and are cleared on save. The component only ever receives masked status
 * (isSet + source), never plaintext. Clear reverts a DB override to the env
 * fallback and is only enabled when a DB override exists.
 */

const inputClass =
  'w-full rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

const primaryBtn =
  'rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'

const ghostBtn =
  'rounded-[8px] border border-line bg-surface2 px-4 py-2 text-sm font-semibold text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40'

/** Human labels for each managed secret key. */
const SECRET_LABELS: Record<SecretKey, string> = {
  RAZORPAY_KEY_ID: 'Key ID',
  RAZORPAY_KEY_SECRET: 'Key Secret',
  RAZORPAY_WEBHOOK_SECRET: 'Webhook Signing Secret',
  AISENSY_API_KEY: 'API Key',
  AISENSY_WEBHOOK_SECRET: 'Webhook Signing Secret',
}

/** Per-provider configuration driving the two cards. */
type Provider = {
  id: 'razorpay' | 'aisensy'
  name: string
  blurb: string
  /** Credential secrets shown in the top block. */
  credentials: SecretKey[]
  /** The inbound webhook path (appended to appUrl). */
  webhookPath: string
  /** The webhook signing-secret key. */
  webhookSecret: SecretKey
  /** The Test action for this provider. */
  test: () => Promise<ActionResult<void>>
}

const PROVIDERS: Provider[] = [
  {
    id: 'razorpay',
    name: 'Razorpay',
    blurb:
      'Payment links and their inbound payment webhook. Set here to override the environment; leave blank to keep the env fallback.',
    credentials: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    webhookPath: '/api/webhooks/razorpay',
    webhookSecret: 'RAZORPAY_WEBHOOK_SECRET',
    test: testRazorpay,
  },
  {
    id: 'aisensy',
    name: 'AiSensy',
    blurb:
      'WhatsApp campaign API and its inbound message webhook. Set here to override the environment; leave blank to keep the env fallback.',
    credentials: ['AISENSY_API_KEY'],
    webhookPath: '/api/webhooks/aisensy',
    webhookSecret: 'AISENSY_WEBHOOK_SECRET',
    test: testAiSensy,
  },
]

export default function IntegrationsEditor({
  status,
  appUrl,
}: {
  status: IntegrationStatus[]
  appUrl: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Which single control is mid-flight, so only its button shows "Working…".
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Draft input value per secret key (write-only; cleared on save).
  const [drafts, setDrafts] = useState<Partial<Record<SecretKey, string>>>({})
  // Inline error per secret key.
  const [errors, setErrors] = useState<Partial<Record<SecretKey, string>>>({})
  // Test result per provider id.
  const [testResults, setTestResults] = useState<
    Partial<Record<string, { ok: boolean; message: string }>>
  >({})

  const statusByKey = new Map(status.map((s) => [s.key, s]))

  function handleSave(key: SecretKey) {
    const value = (drafts[key] ?? '').trim()
    setErrors((prev) => ({ ...prev, [key]: undefined }))
    if (!value) {
      setErrors((prev) => ({ ...prev, [key]: 'Value is required.' }))
      return
    }
    setPendingId(`save:${key}`)
    startTransition(async () => {
      const result = await setSecret(key, value)
      setPendingId(null)
      if (!result.ok) {
        const fieldError = result.fieldErrors?.value?.[0]
        setErrors((prev) => ({ ...prev, [key]: fieldError ?? result.error }))
        return
      }
      // Never keep the plaintext in state after a successful save.
      setDrafts((prev) => ({ ...prev, [key]: '' }))
      router.refresh()
    })
  }

  function handleClear(key: SecretKey) {
    setErrors((prev) => ({ ...prev, [key]: undefined }))
    setPendingId(`clear:${key}`)
    startTransition(async () => {
      const result = await clearSecret(key)
      setPendingId(null)
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [key]: result.error }))
        return
      }
      setDrafts((prev) => ({ ...prev, [key]: '' }))
      router.refresh()
    })
  }

  function handleTest(provider: Provider) {
    setTestResults((prev) => ({ ...prev, [provider.id]: undefined }))
    setPendingId(`test:${provider.id}`)
    startTransition(async () => {
      const result = await provider.test()
      setPendingId(null)
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: result.ok
          ? { ok: true, message: `${provider.name} connection succeeded.` }
          : { ok: false, message: result.error },
      }))
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Integrations</h2>
        <p className="mt-1 text-sm text-dim">
          Manage provider credentials and inbound webhooks. Secrets are
          encrypted at rest, never shown back, and a value set here overrides the
          environment variable (which remains a fallback). Clearing a value
          reverts to the environment.
        </p>
      </div>

      {PROVIDERS.map((provider) => (
        <section
          key={provider.id}
          className="flex flex-col gap-5 rounded-[12px] border border-line bg-surface p-5"
        >
          <div>
            <h3 className="text-base font-bold tracking-[-0.01em]">
              {provider.name}
            </h3>
            <p className="mt-1 text-sm text-dim">{provider.blurb}</p>
          </div>

          <div className="flex flex-col gap-4">
            {provider.credentials.map((key) => (
              <SecretField
                key={key}
                secretKey={key}
                status={statusByKey.get(key)}
                value={drafts[key] ?? ''}
                error={errors[key]}
                isPending={isPending}
                pendingId={pendingId}
                onChange={(v) => setDrafts((prev) => ({ ...prev, [key]: v }))}
                onSave={() => handleSave(key)}
                onClear={() => handleClear(key)}
              />
            ))}
          </div>

          <WebhookBlock
            provider={provider}
            appUrl={appUrl}
            status={statusByKey.get(provider.webhookSecret)}
            value={drafts[provider.webhookSecret] ?? ''}
            error={errors[provider.webhookSecret]}
            testResult={testResults[provider.id]}
            isPending={isPending}
            pendingId={pendingId}
            onChange={(v) =>
              setDrafts((prev) => ({ ...prev, [provider.webhookSecret]: v }))
            }
            onSave={() => handleSave(provider.webhookSecret)}
            onClear={() => handleClear(provider.webhookSecret)}
            onTest={() => handleTest(provider)}
          />
        </section>
      ))}
    </div>
  )
}

/** Masked status chip — Set (DB) / Set (env) / Not set. */
function StatusChip({ status }: { status: IntegrationStatus | undefined }) {
  if (status?.source === 'db') {
    return (
      <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-green">
        Set (DB)
      </span>
    )
  }
  if (status?.source === 'env') {
    return (
      <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-dim">
        Set (env)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-faint">
      Not set
    </span>
  )
}

/** One write-only secret row: label + chip, password input, Save + Clear. */
function SecretField({
  secretKey,
  status,
  value,
  error,
  isPending,
  pendingId,
  onChange,
  onSave,
  onClear,
}: {
  secretKey: SecretKey
  status: IntegrationStatus | undefined
  value: string
  error: string | undefined
  isPending: boolean
  pendingId: string | null
  onChange: (value: string) => void
  onSave: () => void
  onClear: () => void
}) {
  const saving = pendingId === `save:${secretKey}`
  const clearing = pendingId === `clear:${secretKey}`
  // Only a DB override can be cleared (env/none have no row to remove).
  const canClear = status?.source === 'db'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className={labelClass}>{SECRET_LABELS[secretKey]}</span>
        <StatusChip status={status} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={status?.isSet ? 'Enter a new value to replace' : 'Enter a value'}
          autoComplete="off"
          spellCheck={false}
          aria-label={SECRET_LABELS[secretKey]}
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className={primaryBtn}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={isPending || !canClear}
            title={
              canClear ? undefined : 'No stored override to clear.'
            }
            className={ghostBtn}
          >
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Per-provider Webhooks block: URL + Copy, signing secret, Test. */
function WebhookBlock({
  provider,
  appUrl,
  status,
  value,
  error,
  testResult,
  isPending,
  pendingId,
  onChange,
  onSave,
  onClear,
  onTest,
}: {
  provider: Provider
  appUrl: string
  status: IntegrationStatus | undefined
  value: string
  error: string | undefined
  testResult: { ok: boolean; message: string } | undefined
  isPending: boolean
  pendingId: string | null
  onChange: (value: string) => void
  onSave: () => void
  onClear: () => void
  onTest: () => void
}) {
  const [copied, setCopied] = useState(false)
  const webhookUrl = `${appUrl.replace(/\/$/, '')}${provider.webhookPath}`
  const testing = pendingId === `test:${provider.id}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (insecure context); the URL is still shown.
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[8px] border border-line bg-surface2 p-4">
      <p className="text-sm font-semibold text-text">Webhooks</p>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Inbound URL</span>
        <p className="text-xs text-dim">
          Register this URL in the {provider.name} dashboard.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="flex-1 overflow-x-auto rounded-[8px] border border-line bg-surface px-3 py-2 text-xs text-text">
            {webhookUrl}
          </code>
          <button type="button" onClick={copy} className={ghostBtn}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <SecretField
        secretKey={provider.webhookSecret}
        status={status}
        value={value}
        error={error}
        isPending={isPending}
        pendingId={pendingId}
        onChange={onChange}
        onSave={onSave}
        onClear={onClear}
      />

      <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onTest}
          disabled={isPending}
          className={ghostBtn}
        >
          {testing ? 'Testing…' : `Test ${provider.name}`}
        </button>
        {testResult ? (
          <p
            role={testResult.ok ? 'status' : 'alert'}
            className={[
              'text-sm font-medium',
              testResult.ok ? 'text-green' : 'text-red',
            ].join(' ')}
          >
            {testResult.message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
