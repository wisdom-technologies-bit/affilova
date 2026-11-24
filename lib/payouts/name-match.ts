// Do the name on the bank account and the name on the profile look like the same
// person?
//
// This is a soft check that protects a payout from going to the wrong account,
// not an identity check. It is deliberately generous about order, middle names
// and honorifics, and deliberately strict about a single shared word: "Adaeze
// Okonkwo" and "Adaeze Bello" share one token and are almost certainly two
// different people.

/** Titles that carry no identity, stripped before comparing. */
const HONORIFICS: ReadonlySet<string> = new Set([
  "mr",
  "mrs",
  "miss",
  "ms",
  "dr",
  "prof",
  "chief",
  "alhaji",
  "alhaja",
  "hajia",
  "sir",
  "madam",
  "engr",
  "barr",
])

/**
 * Lowercase, fold accents, drop apostrophes, turn other punctuation into a
 * space, and remove honorifics. An empty string yields an empty list.
 */
export function normaliseName(value: string): string[] {
  const folded = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

  if (folded === "") {
    return []
  }

  return folded.split(" ").filter((token) => token !== "" && !HONORIFICS.has(token))
}

/**
 * True when the two names plausibly describe one person.
 *
 * A match needs either two tokens in common, or every token of the shorter name
 * present in the longer one. A name that normalises to nothing never matches,
 * and two multi-token names that share exactly one token never match.
 */
export function namesMatch(profileName: string, resolvedName: string): boolean {
  const left = normaliseName(profileName)
  const right = normaliseName(resolvedName)

  if (left.length === 0 || right.length === 0) {
    return false
  }

  const rightSet = new Set(right)
  const common = left.filter((token) => rightSet.has(token)).length

  if (common === 0) {
    return false
  }

  if (common >= 2) {
    return true
  }

  const shorter = Math.min(left.length, right.length)

  // One token in common is only enough when one of the names is that one token:
  // a profile that says only "Adaeze" against "ADAEZE OKONKWO" is a match, while
  // "Adaeze Okonkwo" against "Adaeze Bello" is not.
  return common === shorter
}
