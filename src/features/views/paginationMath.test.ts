import { describe, it, expect } from 'vitest'
import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  clampPageSize,
  pageCount,
  clampPage,
  offsetFor,
} from './paginationMath'

/**
 * Unit tests for the pure page-math (plan Task 1.1). No DB, no React — clamps +
 * offset arithmetic only.
 */

describe('PAGE_SIZES / DEFAULT_PAGE_SIZE', () => {
  it('is the locked [25,50,100] set defaulting to 25', () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100])
    expect(DEFAULT_PAGE_SIZE).toBe(25)
  })
})

describe('clampPageSize', () => {
  it('passes through each allowed size', () => {
    expect(clampPageSize(25)).toBe(25)
    expect(clampPageSize(50)).toBe(50)
    expect(clampPageSize(100)).toBe(100)
  })

  it('accepts allowed sizes given as strings (URL params)', () => {
    expect(clampPageSize('50')).toBe(50)
    expect(clampPageSize('100')).toBe(100)
  })

  it('falls back to 25 for junk / undefined / null', () => {
    expect(clampPageSize(undefined)).toBe(25)
    expect(clampPageSize(null)).toBe(25)
    expect(clampPageSize('abc')).toBe(25)
    expect(clampPageSize('')).toBe(25)
    expect(clampPageSize(NaN)).toBe(25)
  })

  it('falls back to 25 for an out-of-set number', () => {
    expect(clampPageSize(30)).toBe(25)
    expect(clampPageSize(0)).toBe(25)
    expect(clampPageSize(-50)).toBe(25)
    expect(clampPageSize(1000)).toBe(25)
  })
})

describe('pageCount', () => {
  it('is at least 1 for an empty result', () => {
    expect(pageCount(0, 25)).toBe(1)
  })

  it('ceils to whole pages', () => {
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
    expect(pageCount(50, 25)).toBe(2)
    expect(pageCount(51, 25)).toBe(3)
  })

  it('degrades to 1 page for a non-positive/non-finite pageSize', () => {
    expect(pageCount(100, 0)).toBe(1)
    expect(pageCount(100, -25)).toBe(1)
    expect(pageCount(100, NaN)).toBe(1)
  })

  it('treats negative/non-finite totals as empty', () => {
    expect(pageCount(-5, 25)).toBe(1)
    expect(pageCount(NaN, 25)).toBe(1)
  })
})

describe('clampPage', () => {
  it('clamps below-range values up to 1', () => {
    expect(clampPage(0, 100, 25)).toBe(1)
    expect(clampPage(-3, 100, 25)).toBe(1)
    expect(clampPage(undefined, 100, 25)).toBe(1)
    expect(clampPage('abc', 100, 25)).toBe(1)
  })

  it('clamps above-range values down to the last page', () => {
    // 100 rows / 25 = 4 pages.
    expect(clampPage(99, 100, 25)).toBe(4)
    // 1 page total.
    expect(clampPage(99, 10, 25)).toBe(1)
  })

  it('keeps a valid in-range page', () => {
    expect(clampPage(2, 100, 25)).toBe(2)
    expect(clampPage('3', 100, 25)).toBe(3)
    expect(clampPage(4, 100, 25)).toBe(4)
  })

  it('floors fractional page values', () => {
    expect(clampPage(2.9, 100, 25)).toBe(2)
  })
})

describe('offsetFor', () => {
  it('is (page - 1) * pageSize', () => {
    expect(offsetFor(1, 25)).toBe(0)
    expect(offsetFor(2, 25)).toBe(25)
    expect(offsetFor(3, 50)).toBe(100)
    expect(offsetFor(4, 100)).toBe(300)
  })
})
