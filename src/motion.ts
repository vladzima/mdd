// React unmounts the moment a condition goes false, which leaves no frame for an
// exit animation to run in. This keeps the last value on screen for `ms` longer
// and reports that it is leaving, so CSS can play it out.
//
// Entrances need none of this — `@starting-style` gives the browser a from-state
// for an element that was just inserted, so they are pure CSS.

import { useEffect, useState } from 'react'

export function useLingering<T>(value: T | null, ms: number): [T | null, boolean] {
  const [shown, setShown] = useState<T | null>(value)
  const leaving = value === null && shown !== null

  // Seeded during render rather than in an effect, so a new value never paints
  // for a frame as the old one.
  if (value !== null && value !== shown) setShown(value)

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setShown(null), ms)
    return () => clearTimeout(timer)
  }, [leaving, ms])

  return [shown, leaving]
}
