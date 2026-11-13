// A "next" query parameter is user supplied, so it is only ever used to build a
// same-site redirect after it has been proved to be a relative path. Anything
// that could leave the site falls back instead.

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function isSameSiteRelativePath(value: string): boolean {
  // Exactly one leading slash. "//host" and "/\host" are both treated as
  // protocol-relative by browsers, so neither is allowed.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return false
  }

  // A scheme, a backslash or a control character anywhere means it is not a
  // plain path. "javascript:alert(1)" is caught by the leading-slash rule;
  // "://" and the backslash check catch the rest.
  if (value.includes("://") || value.includes("\\") || CONTROL_CHARACTERS.test(value)) {
    return false
  }

  return true
}

export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (typeof value !== "string" || value === "") {
    return fallback
  }

  if (!isSameSiteRelativePath(value)) {
    return fallback
  }

  // Percent-encoding can hide a second slash or a backslash, so the result is
  // checked again after one decode. "/%2F%2Fevil.com" becomes "///evil.com"
  // and is rejected. The value that comes back is the original, not the
  // decoded one.
  let decoded: string

  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Malformed encoding, e.g. "/%zz".
    return fallback
  }

  if (decoded !== value && !isSameSiteRelativePath(decoded)) {
    return fallback
  }

  return value
}
