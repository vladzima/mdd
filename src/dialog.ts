// In-app confirm / rename / error, instead of the browser's own dialogs.
//
// window.confirm and friends put the hostname in a system chrome box, block the
// page, and cannot be styled or themed — a rename box that says "edit.computer
// says" is not the app asking. These are the same three calls as promises.

import { create } from 'zustand'

export type Request =
  | { kind: 'confirm'; message: string; confirmLabel: string; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; message: string; value: string; resolve: (value: string | null) => void }
  | { kind: 'alert'; message: string; resolve: () => void }

export const useDialog = create<{ request: Request | null }>(() => ({ request: null }))

// Whatever had the keyboard when the dialog was asked for, so answering it can
// hand focus back. Read here rather than inside the dialog: by the time it has
// mounted and autofocused, the activeElement is already its own button.
let opener: HTMLElement | null = null

export function returnFocus(): void {
  opener?.focus?.()
  opener = null
}

function open<T>(build: (resolve: (value: T) => void) => Request): Promise<T> {
  // One at a time: whatever was on screen is answered as a refusal so its caller
  // never hangs waiting for a reply that a second dialog just took over.
  const previous = useDialog.getState().request
  if (!previous) opener = document.activeElement as HTMLElement | null
  previous?.resolve(null as never)
  return new Promise<T>((resolve) => {
    useDialog.setState({
      request: build((value) => {
        useDialog.setState({ request: null })
        resolve(value)
      }),
    })
  })
}

export const ask = (message: string, confirmLabel = 'Delete'): Promise<boolean> =>
  open((resolve) => ({ kind: 'confirm', message, confirmLabel, resolve }))

export const askText = (message: string, value: string): Promise<string | null> =>
  open((resolve) => ({ kind: 'prompt', message, value, resolve }))

export const tell = (message: unknown): Promise<void> =>
  open((resolve) => ({
    kind: 'alert',
    message: message instanceof Error ? message.message : String(message),
    resolve,
  }))
