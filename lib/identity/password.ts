// Breached-password check against the Have I Been Pwned range API.
//
// k-anonymity: the password is hashed with SHA-1 locally and only the first five
// hex characters of that hash are sent. The API answers with every hash suffix
// that shares the prefix, plus padding entries with a count of 0 because of the
// Add-Padding header.
//
// The check fails open. A timeout, a network error or an error response returns
// false, so a HIBP outage can never stop someone from signing up. The trade-off
// is deliberate: this is one layer of password defence, not the only one.

export const HIBP_TIMEOUT_MS = 3000

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/"

// Pure: given the response body and the 35-character suffix of the password's
// SHA-1 hash, reports whether the password appears with a non-zero count.
// Padding entries (count 0) are not breaches, and malformed lines are skipped.
export function parseHibpRangeResponse(body: string, suffix: string): boolean {
  const wanted = suffix.trim().toUpperCase()

  if (wanted === "") {
    return false
  }

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (trimmed === "") {
      continue
    }

    const separator = trimmed.indexOf(":")

    if (separator === -1) {
      continue
    }

    const hash = trimmed.slice(0, separator).trim().toUpperCase()

    if (hash !== wanted) {
      continue
    }

    const count = Number.parseInt(trimmed.slice(separator + 1).trim(), 10)

    if (Number.isFinite(count) && count > 0) {
      return true
    }
  }

  return false
}

async function sha1Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-1", bytes)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
}

export async function isPasswordBreached(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS)

    let response: Response

    try {
      response = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
        method: "GET",
        headers: { "Add-Padding": "true" },
        cache: "no-store",
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      return false
    }

    return parseHibpRangeResponse(await response.text(), suffix)
  } catch {
    // Timeout, network failure, unexpected response: fail open.
    return false
  }
}
