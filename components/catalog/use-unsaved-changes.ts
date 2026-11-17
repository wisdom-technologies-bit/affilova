"use client"

import { useEffect } from "react"

// Ask before a page with unsaved edits is closed or reloaded.
//
// The browser shows its own wording here; a page cannot replace it. In-app
// navigation is handled by the forms themselves, which keep the Save button and
// the "Unsaved changes" note visible.

export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      return undefined
    }

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      // Chrome and Firefox both read returnValue; leaving it set keeps Safari
      // in line too.
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", onBeforeUnload)

    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])
}
