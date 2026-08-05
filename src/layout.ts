// Breakpoints shared by the components and index.css — keep the strings in step
// with the @media rules there.

// below this the sidebar is an overlay drawer rather than a column
export const NARROW = '(max-width: 700px)'
// `any-pointer`, not `pointer`: attaching a mouse to an iPad reports a fine
// pointer while the screen is still a touchscreen
export const TOUCH = '(any-pointer: coarse)'

export const isNarrow = (): boolean => matchMedia(NARROW).matches
export const isTouch = (): boolean => matchMedia(TOUCH).matches
