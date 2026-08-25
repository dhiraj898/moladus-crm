import { describe, it, expect } from 'vitest'
import { resolveViewMode } from './useViewMode'
import type { ViewMode } from './types'

const ALL: ViewMode[] = ['kanban', 'table', 'list']
const NO_KANBAN: ViewMode[] = ['table', 'list']

describe('resolveViewMode', () => {
  it('uses a valid, supported URL value first', () => {
    expect(resolveViewMode('table', 'kanban', ALL)).toBe('table')
    expect(resolveViewMode('list', null, ALL)).toBe('list')
  })

  it('falls back to the stored value when the URL value is invalid', () => {
    expect(resolveViewMode('bogus', 'table', ALL)).toBe('table')
    expect(resolveViewMode('', 'list', ALL)).toBe('list')
  })

  it('falls back to the stored value when the URL value is unsupported for this entity', () => {
    // kanban is a valid mode but not offered here → skip to stored.
    expect(resolveViewMode('kanban', 'list', NO_KANBAN)).toBe('list')
  })

  it('falls back to modes[0] when the stored value is unsupported', () => {
    expect(resolveViewMode(null, 'kanban', NO_KANBAN)).toBe('table')
  })

  it('falls back to modes[0] when the stored value is invalid', () => {
    expect(resolveViewMode(null, 'bogus', ALL)).toBe('kanban')
  })

  it('falls back to modes[0] when both URL and stored are empty', () => {
    expect(resolveViewMode(null, null, ALL)).toBe('kanban')
    expect(resolveViewMode(null, null, NO_KANBAN)).toBe('table')
  })

  it('prefers a valid URL value over a valid stored value', () => {
    expect(resolveViewMode('list', 'table', ALL)).toBe('list')
  })
})
