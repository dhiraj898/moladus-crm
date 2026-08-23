import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import type { Message } from '@/lib/supabase/types'

/** Digits-only phone normalization, shared with the inbound webhook. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CONVERSATION_LIMIT = 500

/**
 * Load a WhatsApp conversation, matched by contact_id OR normalized phone (so
 * messages captured before the contact link, or with contact_id null, still
 * appear). Oldest-first for chat rendering. Returns [] when no valid key.
 * Both keys are validated/sanitized before interpolation into the .or() filter.
 */
export async function getConversation(params: {
  contactId?: string | null
  whatsappNumber?: string | null
}): Promise<Message[]> {
  const contactId =
    params.contactId && UUID_RE.test(params.contactId) ? params.contactId : null
  const phone = normalizePhone(params.whatsappNumber)

  const filters: string[] = []
  if (contactId) filters.push(`contact_id.eq.${contactId}`)
  if (phone) filters.push(`phone_number.eq.${phone}`)
  if (filters.length === 0) return []

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(filters.join(','))
    .order('sent_at', { ascending: true })
    .limit(CONVERSATION_LIMIT)

  if (error) throw new Error(`Failed to load conversation: ${error.message}`)
  return (data ?? []) as unknown as Message[]
}
