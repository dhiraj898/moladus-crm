'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { FormField } from '@/lib/supabase/types'
import { type Answer, type AnswersMap, visibleFields } from './visibility'

/**
 * Navigation state for the one-at-a-time public form (plan Task 6.3 Step 1).
 *
 * Holds the collected answers map and the "current field" (tracked by key, not
 * a raw index, so revealing/hiding conditional fields never lands the user on
 * the wrong screen). `next()` / `back()` skip hidden fields by re-deriving the
 * visible set from the latest answers, and progress is measured within that
 * visible set.
 *
 * The visible set is recomputed on every answer change, so `totalVisible` and
 * `isLast` stay accurate as conditional fields appear or disappear while the
 * user is still on the current field.
 */

/** Slide direction for the transition CSS in FormRunner. */
export type NavDirection = 'forward' | 'back'

export interface FormNav {
  /** All collected answers, keyed by `field.key`. */
  answers: AnswersMap
  /** The currently-visible ordered field list. */
  visible: FormField[]
  /** The field currently on screen, or `null` when the form has no fields. */
  current: FormField | null
  /** Zero-based position of `current` within `visible`. */
  currentIndex: number
  /** Count of currently-visible fields (progress denominator). */
  totalVisible: number
  /** True on the first visible field (hide Back). */
  isFirst: boolean
  /** True on the last visible field (show Submit instead of Continue). */
  isLast: boolean
  /** Direction of the most recent navigation, for transition classes. */
  direction: NavDirection
  /** Store an answer for a field without navigating (controlled inputs). */
  setAnswer: (key: string, value: Answer) => void
  /** Advance to the next visible field using the latest answers. */
  next: () => void
  /** Return to the previous visible field. */
  back: () => void
  /**
   * Commit the current field's value and advance in a single tick — for
   * auto-advancing fields (yes_no, statement) where the answer and the
   * navigation happen on the same event and must be evaluated together.
   */
  setAnswerAndAdvance: (value: Answer) => void
}

export function useFormNav(fields: FormField[]): FormNav {
  const [answers, setAnswers] = useState<AnswersMap>({})
  const [currentKey, setCurrentKey] = useState<string | null>(
    () => visibleFields(fields, {})[0]?.key ?? null
  )
  const [direction, setDirection] = useState<NavDirection>('forward')

  // Refs mirror the latest committed state so event handlers that both mutate
  // answers and navigate in the same tick read fresh values, not stale closures.
  const answersRef = useRef(answers)
  answersRef.current = answers
  const currentKeyRef = useRef(currentKey)
  currentKeyRef.current = currentKey

  const visible = useMemo(
    () => visibleFields(fields, answers),
    [fields, answers]
  )

  const currentIndex = useMemo(() => {
    if (currentKey == null) return 0
    const i = visible.findIndex((f) => f.key === currentKey)
    return i === -1 ? 0 : i
  }, [visible, currentKey])

  const current = visible[currentIndex] ?? null
  const totalVisible = visible.length
  const isFirst = currentIndex <= 0
  const isLast = totalVisible === 0 || currentIndex >= totalVisible - 1

  const setAnswer = useCallback((key: string, value: Answer) => {
    const merged = { ...answersRef.current, [key]: value }
    answersRef.current = merged
    setAnswers(merged)
  }, [])

  /** Move to the field adjacent to `current` within the given answers map. */
  const move = useCallback(
    (dir: NavDirection, forAnswers: AnswersMap) => {
      const vis = visibleFields(fields, forAnswers)
      const key = currentKeyRef.current
      const idx = key == null ? 0 : vis.findIndex((f) => f.key === key)
      const target = dir === 'forward' ? vis[idx + 1] : vis[idx - 1]
      if (!target) return
      setDirection(dir)
      currentKeyRef.current = target.key
      setCurrentKey(target.key)
    },
    [fields]
  )

  const next = useCallback(
    () => move('forward', answersRef.current),
    [move]
  )
  const back = useCallback(() => move('back', answersRef.current), [move])

  const setAnswerAndAdvance = useCallback(
    (value: Answer) => {
      const key = currentKeyRef.current
      const merged =
        key == null ? answersRef.current : { ...answersRef.current, [key]: value }
      answersRef.current = merged
      setAnswers(merged)
      move('forward', merged)
    },
    [move]
  )

  return {
    answers,
    visible,
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
  }
}
