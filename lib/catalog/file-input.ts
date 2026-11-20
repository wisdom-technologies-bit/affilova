// Reading a file input without losing the files.
//
// `input.files` is a live FileList, not a snapshot. Resetting `input.value` so
// the same file can be chosen twice clears that list in place, which means the
// usual one-liner
//
//     const chosen = event.target.files
//     event.target.value = ""
//     accept(chosen)
//
// hands `accept` an empty list every time: the picker closes, nothing uploads,
// and the screen looks like it did not respond. This module copies the files
// first and only then clears the input.

export type FileInputTarget = {
  /** `input.files`, which may be null on a browser that does not support it. */
  files: ArrayLike<File> | null
  /** `input.value`, which is reset so the same file can be chosen again. */
  value: string
}

/**
 * The chosen files, copied out of the input before the input is cleared.
 *
 * The copy is what makes this safe: after `value` is reset the original
 * FileList is empty, so anything holding a reference to it sees nothing.
 */
export function takeChosenFiles(target: FileInputTarget): File[] {
  const chosen = target.files === null ? [] : Array.from(target.files)

  target.value = ""

  return chosen
}
