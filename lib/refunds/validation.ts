// The two refund forms share one rule: a reason a person can act on.
//
// A buyer asking for their money back, and a vendor declining, both have to say
// why in at least ten characters. The rule lives here so the form, the dialog and
// the tests cannot disagree about it.

export const MIN_REFUND_REASON = 10
export const MIN_REJECT_NOTE = 10

export const REFUND_REASON_ERROR = `Give a reason of at least ${MIN_REFUND_REASON} characters.`
export const REJECT_NOTE_ERROR = `Give a reason of at least ${MIN_REJECT_NOTE} characters.`

/** The sentence to show, or null when the reason is long enough. */
export function refundReasonError(reason: string): string | null {
  return reason.trim().length < MIN_REFUND_REASON ? REFUND_REASON_ERROR : null
}

/** The sentence to show, or null when the vendor's note is long enough. */
export function rejectNoteError(note: string): string | null {
  return note.trim().length < MIN_REJECT_NOTE ? REJECT_NOTE_ERROR : null
}

/** How many characters are still needed, for the helper line under the field. */
export function charactersNeeded(value: string, minimum: number): number {
  return Math.max(0, minimum - value.trim().length)
}
