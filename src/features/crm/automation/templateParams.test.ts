import { describe, it, expect } from 'vitest'
import {
  paramTokensFromConfig,
  resolveTemplateParams,
  tokensNeedPaymentLink,
  DEFAULT_PARAM_TOKENS,
} from './templateParams'

const ctx = { name: 'Asha', paymentLink: 'https://rzp.io/x', productName: 'Taste Sprint', amount: '₹2,948.82', email: 'a@test.com' }

describe('templateParams', () => {
  it('resolves configured tokens in the declared order (payment link = 4 params)', () => {
    const tokens = paramTokensFromConfig({ params: ['name', 'product', 'amount', 'payment_link'] })
    expect(resolveTemplateParams(tokens, ctx)).toEqual([
      'Asha',
      'Taste Sprint',
      '₹2,948.82',
      'https://rzp.io/x',
    ])
  })

  it('falls back to the default order when no params are configured', () => {
    expect(paramTokensFromConfig({ template: 'x' })).toEqual(DEFAULT_PARAM_TOKENS)
    expect(resolveTemplateParams(DEFAULT_PARAM_TOKENS, ctx)).toEqual([
      'Asha',
      'https://rzp.io/x',
      'Taste Sprint',
    ])
  })

  it('drops unknown tokens; an empty list falls back to defaults', () => {
    expect(paramTokensFromConfig({ params: ['name', 'bogus'] })).toEqual(['name'])
    expect(paramTokensFromConfig({ params: [] })).toEqual(DEFAULT_PARAM_TOKENS)
  })

  it('tokensNeedPaymentLink detects the link token', () => {
    expect(tokensNeedPaymentLink(['name', 'payment_link'])).toBe(true)
    expect(tokensNeedPaymentLink(['name', 'product', 'amount'])).toBe(false)
  })
})
