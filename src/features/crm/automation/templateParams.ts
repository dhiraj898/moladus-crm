import 'server-only'

/**
 * Data-driven AiSensy template parameters.
 *
 * A `send_whatsapp` stage action or SLA rule stores an ordered list of param
 * TOKENS in its `config.params`, e.g. `["name","product","amount","payment_link"]`.
 * At send time each token is resolved from the deal context into the string
 * passed as AiSensy `templateParams[i]`. This lets each approved AiSensy
 * campaign declare EXACTLY the variables it has — AiSensy rejects (400) a send
 * whose param count/placement differs from the template — without a code change
 * per template.
 *
 * When a config declares no `params`, we fall back to {@link DEFAULT_PARAM_TOKENS}
 * so existing single-purpose templates keep working.
 */

/** A value a template param can reference, resolved from the deal context. */
export type ParamToken = 'name' | 'payment_link' | 'product' | 'amount' | 'email'

export interface TemplateParamContext {
  name: string
  paymentLink: string
  productName: string
  amount: string
  email: string
}

/** Fallback param order when a config declares no `params`. */
export const DEFAULT_PARAM_TOKENS: ParamToken[] = ['name', 'payment_link', 'product']

const RESOLVERS: Record<ParamToken, (ctx: TemplateParamContext) => string> = {
  name: (c) => c.name,
  payment_link: (c) => c.paymentLink,
  product: (c) => c.productName,
  amount: (c) => c.amount,
  email: (c) => c.email,
}

function isParamToken(v: unknown): v is ParamToken {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RESOLVERS, v)
}

/**
 * Read the ordered param tokens from a `send_whatsapp` action/rule config.
 * Returns the configured tokens when `config.params` is a non-empty array of
 * known tokens; otherwise the default order.
 */
export function paramTokensFromConfig(config: Record<string, unknown>): ParamToken[] {
  const raw = (config as { params?: unknown }).params
  if (Array.isArray(raw)) {
    const tokens = raw.filter(isParamToken)
    if (tokens.length > 0) return tokens
  }
  return DEFAULT_PARAM_TOKENS
}

/** Build the ordered AiSensy `templateParams` from tokens + context. */
export function resolveTemplateParams(
  tokens: ParamToken[],
  ctx: TemplateParamContext
): string[] {
  return tokens.map((t) => RESOLVERS[t](ctx))
}

/**
 * Whether these tokens carry the payment link — used to gate a send: a template
 * that includes `payment_link` must NOT be dispatched with an empty link (it
 * would deliver a broken message). Templates whose params omit the link are
 * never gated.
 */
export function tokensNeedPaymentLink(tokens: ParamToken[]): boolean {
  return tokens.includes('payment_link')
}
