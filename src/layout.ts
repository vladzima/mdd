// Breakpoints shared by the components and index.css — keep the strings in step
// with the @media rules there.

import { useEffect, useState } from 'react'

// below this the sidebar is an overlay drawer rather than a column
export const NARROW = '(max-width: 700px)'
// `any-pointer`, not `pointer`: attaching a mouse to an iPad reports a fine
// pointer while the screen is still a touchscreen
export const TOUCH = '(any-pointer: coarse)'

export const isNarrow = (): boolean => matchMedia(NARROW).matches
export const isTouch = (): boolean => matchMedia(TOUCH).matches

// Reactive version, for the places that have to re-render when the breakpoint
// changes rather than just read it once during an event.
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    const mq = matchMedia(NARROW)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}
