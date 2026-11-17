// Product addresses. The same rules are a CHECK on public.products.slug and are
// mirrored in public.catalog_slugify(), so a slug made here is always acceptable
// to the database and vice versa.

// The pattern in the products table is ^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$, which
// means a first character, at least two in the middle and a last character: four
// characters at the very least.
export const MIN_SLUG_LENGTH = 4
export const MAX_SLUG_LENGTH = 80

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$/

/**
 * Turn a title into a slug: lowercase, no diacritics, runs of anything that is
 * not a letter or a digit become one hyphen, no leading or trailing hyphen, at
 * most 80 characters.
 *
 * Returns an empty string when nothing usable is left, which is what
 * {@link isValidProductSlug} then refuses.
 */
export function slugify(title: string): string {
  const plain = title
    .normalize("NFD")
    // Combining marks: the accent left behind by NFD.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Anything that is not a-z or 0-9 is a separator, including underscores,
    // punctuation and non-Latin scripts (which have no transliteration here).
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")

  if (plain.length <= MAX_SLUG_LENGTH) {
    return plain
  }

  // Cutting can leave a trailing hyphen, which the pattern would refuse.
  return plain.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "")
}

/** True for a value the products table will accept as a slug. */
export function isValidProductSlug(slug: string): boolean {
  return slug.length >= MIN_SLUG_LENGTH && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)
}
