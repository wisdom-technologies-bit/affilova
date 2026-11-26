import { SUBJECT_TITLE_MAX } from "@/emails/types"

// Subject lines, and the one rule they all follow.
//
// A product title is a string a vendor typed. It can be 300 characters, it can
// contain a newline, and a newline in a subject is a broken header: the value is
// flattened first and then cut, so the subject a mail client receives is one
// line of at most SUBJECT_TITLE_MAX characters of the vendor's words.
//
// The cut happens on the title, not on the finished subject: "Your download
// link: " is ours and is never what gets shortened.

/** Runs of any whitespace, including the newlines a pasted title carries. */
const WHITESPACE_RUN = /\s+/g

/**
 * A user-supplied title, ready for a subject line: one line, at most 80
 * characters, with an ellipsis when something was cut.
 */
export function subjectTitle(value: string): string {
  const flat = value.replace(WHITESPACE_RUN, " ").trim()

  if (flat.length <= SUBJECT_TITLE_MAX) {
    return flat
  }

  // One character is spent on the ellipsis, so 79 of the title's characters
  // survive and the whole title portion is exactly 80.
  return `${flat.slice(0, SUBJECT_TITLE_MAX - 1).trimEnd()}…`
}

/** A subject line built from a fixed prefix and a user-supplied title. */
export function subjectWithTitle(prefix: string, title: string): string {
  return `${prefix}${subjectTitle(title)}`
}
