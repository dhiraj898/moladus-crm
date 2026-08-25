import { describe, it, expect } from 'vitest'
import {
  KANBAN_COLUMN_LIMIT,
  isKanbanEntity,
  clampColumnOffset,
  columnWindow,
} from './kanbanPaging'

/**
 * Unit tests for the pure Kanban paging math (plan Task 3.1). No DB, no React —
 * the offset clamp + fixed-window arithmetic + entity whitelist only. The DB
 * round-trip in `loadColumnRows` / the count queries is ENV-PENDING.
 */

describe('KANBAN_COLUMN_LIMIT', () => {
  it('is the locked per-column cap of 50', () => {
    expect(KANBAN_COLUMN_LIMIT).toBe(50)
  })
})

describe('isKanbanEntity', () => {
  it('accepts the two Kanban entities', () => {
    expect(isKanbanEntity('deals')).toBe(true)
    expect(isKanbanEntity('leads')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isKanbanEntity('contacts')).toBe(false)
    expect(isKanbanEntity('')).toBe(false)
    expect(isKanbanEntity(undefined)).toBe(false)
    expect(isKanbanEntity(null)).toBe(false)
    expect(isKanbanEntity(42)).toBe(false)
  })
})

describe('clampColumnOffset', () => {
  it('passes through a valid non-negative offset', () => {
    expect(clampColumnOffset(0)).toBe(0)
    expect(clampColumnOffset(50)).toBe(50)
    expect(clampColumnOffset(150)).toBe(150)
  })

  it('accepts a numeric string (client/form value)', () => {
    expect(clampColumnOffset('50')).toBe(50)
    expect(clampColumnOffset('100')).toBe(100)
  })

  it('floors fractional offsets', () => {
    expect(clampColumnOffset(50.9)).toBe(50)
  })

  it('collapses junk / undefined / negatives to 0', () => {
    expect(clampColumnOffset(undefined)).toBe(0)
    expect(clampColumnOffset(null)).toBe(0)
    expect(clampColumnOffset('abc')).toBe(0)
    expect(clampColumnOffset('')).toBe(0)
    expect(clampColumnOffset(NaN)).toBe(0)
    expect(clampColumnOffset(-5)).toBe(0)
    expect(clampColumnOffset(-0.5)).toBe(0)
  })
})

describe('columnWindow', () => {
  it('pairs a clamped offset with the fixed per-column limit', () => {
    expect(columnWindow(0)).toEqual({ offset: 0, limit: KANBAN_COLUMN_LIMIT })
    expect(columnWindow(50)).toEqual({ offset: 50, limit: KANBAN_COLUMN_LIMIT })
    expect(columnWindow('100')).toEqual({
      offset: 100,
      limit: KANBAN_COLUMN_LIMIT,
    })
  })

  it('clamps a forged/garbage offset to a safe window', () => {
    expect(columnWindow(-999)).toEqual({ offset: 0, limit: KANBAN_COLUMN_LIMIT })
    expect(columnWindow('junk')).toEqual({
      offset: 0,
      limit: KANBAN_COLUMN_LIMIT,
    })
  })
})
