import { describe, it, expect } from 'vitest'
import {
  can,
  scopeFor,
  ownerScopeFilter,
  firstAllowedModule,
  modulePath,
  normalizePermissions,
  DEFAULT_DENY_ALL,
} from './can'
import type { Permissions } from '@/lib/supabase/types'

const FULL: Permissions = {
  products: { view: true, edit: true },
  forms: { view: true, edit: true },
  leads: { view: true, edit: true, scope: 'all' },
  deals: { view: true, edit: true, scope: 'all' },
  contacts: { view: true, edit: true },
  settings: { view: true, edit: true },
  automation: { view: true, edit: true },
}

const AGENT: Permissions = {
  products: { view: false, edit: false },
  forms: { view: false, edit: false },
  leads: { view: true, edit: true, scope: 'own' },
  deals: { view: true, edit: true, scope: 'own' },
  contacts: { view: true, edit: false },
  settings: { view: false, edit: false },
  automation: { view: false, edit: false },
}

describe('can', () => {
  it('grants when the module capability is true', () => {
    expect(can(FULL, 'products', 'edit')).toBe(true)
    expect(can(AGENT, 'leads', 'view')).toBe(true)
  })
  it('denies when false', () => {
    expect(can(AGENT, 'products', 'view')).toBe(false)
    expect(can(AGENT, 'contacts', 'edit')).toBe(false)
  })
})

describe('scopeFor', () => {
  it('reads the record-module scope', () => {
    expect(scopeFor(FULL, 'leads')).toBe('all')
    expect(scopeFor(AGENT, 'deals')).toBe('own')
  })
})

describe('ownerScopeFilter', () => {
  it('returns the user id for own scope, null for all', () => {
    expect(ownerScopeFilter(AGENT, 'leads', 'u1')).toBe('u1')
    expect(ownerScopeFilter(FULL, 'leads', 'u1')).toBeNull()
  })
})

describe('firstAllowedModule', () => {
  it('returns the first viewable module in order', () => {
    expect(firstAllowedModule(FULL)).toBe('products')
    expect(firstAllowedModule(AGENT)).toBe('leads')
  })
  it('returns null when nothing is viewable', () => {
    expect(firstAllowedModule(DEFAULT_DENY_ALL)).toBeNull()
  })
})

describe('modulePath', () => {
  it('maps modules to routes', () => {
    expect(modulePath('products')).toBe('/admin/products')
    expect(modulePath('settings')).toBe('/admin/settings')
    expect(modulePath('automation')).toBe('/admin/settings/automation')
  })
})

describe('normalizePermissions', () => {
  it('fills missing modules with deny-all (never widens)', () => {
    const p = normalizePermissions({ products: { view: true, edit: true } })
    expect(p.products).toEqual({ view: true, edit: true })
    expect(p.forms).toEqual({ view: false, edit: false })
    expect(p.leads).toEqual({ view: false, edit: false, scope: 'own' })
  })
  it('coerces a corrupt blob to deny-all', () => {
    expect(normalizePermissions(null)).toEqual(DEFAULT_DENY_ALL)
    expect(normalizePermissions('nope')).toEqual(DEFAULT_DENY_ALL)
  })
  it('ignores unknown keys and non-boolean values', () => {
    const p = normalizePermissions({
      products: { view: 'yes', edit: 1 },
      bogus: { view: true },
    })
    expect(p.products).toEqual({ view: false, edit: false })
    expect((p as unknown as Record<string, unknown>).bogus).toBeUndefined()
  })
})
