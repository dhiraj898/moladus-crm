import { describe, it, expect } from 'vitest'
import { groupRows, UNASSIGNED } from './group'

/**
 * Unit tests for the Kanban grouping helper (plan Task 2.1). `groupRows` buckets
 * rows into a record keyed by column id: every declared column is present (even
 * when empty), and rows whose column id is null or not among the declared
 * columns fall into the synthetic `__unassigned` bucket.
 */

interface Row {
  id: string
  col: string | null
}

const columns = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const getColumnId = (r: Row) => r.col

describe('groupRows (plan Task 2.1)', () => {
  it('distributes rows into their declared columns', () => {
    const rows: Row[] = [
      { id: '1', col: 'a' },
      { id: '2', col: 'b' },
      { id: '3', col: 'a' },
    ]

    const grouped = groupRows(rows, getColumnId, columns)

    expect(grouped.a.map((r) => r.id)).toEqual(['1', '3'])
    expect(grouped.b.map((r) => r.id)).toEqual(['2'])
  })

  it('includes every declared column even when empty', () => {
    const grouped = groupRows([], getColumnId, columns)

    expect(Object.keys(grouped)).toEqual(
      expect.arrayContaining(['a', 'b', 'c'])
    )
    expect(grouped.a).toEqual([])
    expect(grouped.b).toEqual([])
    expect(grouped.c).toEqual([])
  })

  it('preserves row order within a column', () => {
    const rows: Row[] = [
      { id: '1', col: 'c' },
      { id: '2', col: 'c' },
      { id: '3', col: 'c' },
    ]

    const grouped = groupRows(rows, getColumnId, columns)

    expect(grouped.c.map((r) => r.id)).toEqual(['1', '2', '3'])
  })

  it('routes null column ids to the __unassigned bucket', () => {
    const rows: Row[] = [{ id: '1', col: null }]

    const grouped = groupRows(rows, getColumnId, columns)

    expect(grouped[UNASSIGNED].map((r) => r.id)).toEqual(['1'])
  })

  it('routes unknown column ids to the __unassigned bucket', () => {
    const rows: Row[] = [{ id: '1', col: 'zzz' }]

    const grouped = groupRows(rows, getColumnId, columns)

    expect(grouped[UNASSIGNED].map((r) => r.id)).toEqual(['1'])
  })

  it('does not create an __unassigned bucket when nothing is unassigned', () => {
    const rows: Row[] = [{ id: '1', col: 'a' }]

    const grouped = groupRows(rows, getColumnId, columns)

    expect(grouped[UNASSIGNED]).toBeUndefined()
  })
})
