# The public marketplace

The marketplace is the part of Affilova a visitor can read without an account:
the listing at `/marketplace`, one page per category, one page per vendor and
the product page at `/p/<slug>`.

Everything on those pages comes from five read functions in
`supabase/migrations/20261125000100_public_marketplace.sql`. There is no other
way in: no public table grant, no client-side query, no cached copy in a page.

## What is public

A product appears in the marketplace only when **both** of these are true:

- the product's status is `live`, and
- its vendor's profile status is `active`.

A draft, a submitted, a paused, a rejected and an archived product are invisible
everywhere, including in the counts. A suspended vendor's shelf is invisible even
though its products are still `live` in the database, which is the point: a
suspension must not leave a storefront that can still take money.

The item shape is the whole public record of a product:

| field | why it is public |
| --- | --- |
| `product_id` | the key a related row and a link are built from |
| `slug` | the product's address |
| `title`, `short_description` | what the vendor wrote for buyers |
| `cover_public_id` | the Cloudinary id, so a page can ask for any width |
| `price_kobo`, `compare_at_price_kobo` | the price, in kobo |
| `category_slug`, `category_name` | where the product sits |
| `vendor_name`, `vendor_slug` | the business name and its storefront |

The following are **never** selected, anywhere in the migration, and the schemas
in `lib/marketplace/types.ts` are `.strict()`, so a field added to a function
later cannot reach a page unnoticed:

- the vendor's support email, phone number or user id;
- the buyer, the order, the affiliate and the commission;
- a product file's name, storage key or count;
- anything about a person's account.

The harness proves this the blunt way: it converts every function's answer to
text and fails if the words `commission`, `affiliate`, `support_email`, `phone`,
`vendor_id` or `buyer` appear in it.

## What is never invented

There are no ratings, no review counts, no sales counts shown as social proof, no
"only 3 left" and no countdown. `best_selling` is a **sort order**, not a claim:
the page never prints how many orders a product has. When there is nothing to
show, the page says so ("No products are listed yet") instead of filling the grid.

## The URL scheme

| URL | What it is |
| --- | --- |
| `/marketplace` | the plain listing, indexable, cached |
| `/marketplace?q=…` | a search, noindex |
| `/marketplace?category=…&min=…&max=…&sort=…` | filters, noindex |
| `/marketplace?cursor=…` | page two and beyond, noindex |
| `/marketplace/<category>` | a category page, indexable, cached |
| `/store/<vendor-slug>` | a storefront, indexable, cached |
| `/p/<product-slug>` | a product, indexable (the existing page) |

Parameters, all optional and all cleaned before use:

| parameter | meaning | invalid value becomes |
| --- | --- | --- |
| `q` | search text, at most 80 characters | dropped |
| `category` | a category slug | dropped |
| `min` | lowest price **in naira** | dropped |
| `max` | highest price **in naira** | dropped |
| `sort` | `newest`, `price_low`, `price_high`, `best_selling` | `newest` |
| `cursor` | the opaque `next_cursor` of the previous page | first page |

Prices are naira in the URL and kobo in the database, converted with
`nairaToKobo()` from `lib/catalog/money.ts`, which reads the two halves of the
number as integers. `1500.50` becomes `150050`; nothing is ever parsed as a
float.

A cursor is base64url JSON carrying the sort it was built for. Presenting a
`price_low` cursor to a `newest` request raises `invalid_cursor` rather than
silently paging a different ordering, which would drop and repeat rows.

## Caching and revalidation

| read | how often | why |
| --- | --- | --- |
| the plain listing | 300 s | the same twelve products for everybody |
| a category page | 300 s | changes only when a vendor publishes or pauses |
| the category index | 300 s | it is the filter's option list |
| the sitemap feed | 300 s | it is a crawl aid, not a live view |
| a search, a filter, a sort, a cursor | never cached | it is the visitor's own question |

The three cached reads are wrapped in `unstable_cache` in
`lib/marketplace/cached.ts` with tags (`marketplace:plain`,
`marketplace:categories`, `marketplace:sitemap`), so a future publish step can
call `revalidateTag` and have a change appear at once instead of within the
window.

Every read goes through one helper in `lib/marketplace/queries.ts` with a **three
second** timeout. A timeout, an error or an answer that does not match its schema
all become the same thing: `null`, which the page renders as an error state with
a retry link. A page never half-renders.

## SEO rules

Indexable:

- `/marketplace` — the plain listing is the canonical entry point;
- `/marketplace/<category>` — one page per category, with its own title,
  description and `h1`, all generated from the category's own name and its live
  count;
- `/store/<slug>` — a vendor's shelf;
- `/p/<slug>` — a product, with `Product` structured data.

Not indexable (`robots: noindex, follow`, canonical to `/marketplace`):

- any listing with `q`, `category`, `min`, `max`, a sort other than the default,
  or a `cursor`.

The reason is that a filtered page is the same products in a different order.
Indexing every combination of search, sort and page number would put hundreds of
near-identical URLs in front of a crawler and bury the pages that matter. They
stay `follow`, so the links inside them still pass through.

`/marketplace`, `/marketplace/<category>`, `/store/<slug>` and `/p/<slug>` are
already allowed by `app/robots.ts` on the public host, which allows `/` and only
disallows the signed-in hosts. No change to that file was needed.

A category or a store that does not exist, is suspended, or has nothing live
answers **404**, not an empty page: an empty page with a real title is a thin
result and a dead end.

## How `best_selling` is calculated

```
orders per product = count(DISTINCT order id)
                     where the order's status is paid, refunded or disputed
                     and the order's paid_at is within the last 90 days
```

- **Only paid orders count.** A pending order, an expired one and a failed one
  are not sales.
- **A refunded order still counts.** It was paid; the refund is a later event
  about the same sale. Excluding it would make a product that sells and refunds
  look identical to one that never sold.
- **The window is 90 days**, so the ranking reflects what is selling now, not
  what sold once.
- **Ties are broken by newest**, then by id, so the order is stable and a cursor
  can page it without gaps.

`newest` orders by `published_at` (falling back to `created_at`), `price_low` and
`price_high` by `price_kobo`; all three break ties the same way. Every sort uses
the same three-column keyset — sort value, published time, id — so pagination is
correct for every one of them.

## Search

A query is cut to 80 characters and its control characters are removed, in the
page (`lib/marketplace/params.ts`) and again in the database.

Matching is three things joined by `OR`:

1. `websearch_to_tsquery('english', q)` over the product's existing
   `search_vector` (title weighted A, short description weighted B) — the
   words a person typed, with web search syntax understood;
2. `title ILIKE '%q%'` — a partial title, with `%`, `_` and `\` escaped so a
   search for `%` looks for a per cent sign rather than matching everything;
3. `q <% title` — trigram word similarity, which is what makes a typo still
   find the product ("ketp" finds "Keto Diet Guide").

All three are index-supported (`products_search_idx`,
`products_title_trgm_idx`), and the harness checks with `EXPLAIN` that the
planner uses an index at 20,000 products.

## Rate limiting

The search path is limited to **120 requests per minute per client address**
through the existing `lib/rate-limit.ts`, keyed by a hash of the address, with
`onError: "allow"` so a database hiccup never locks a person out of searching.
A limited request gets a polite page ("Too many searches") with a link to the
unlimited plain listing. Browsing, filtering and paging are not limited.

## Running the checks

```
pnpm test                                   # vitest, including the render tests
supabase/tests/public_marketplace_test.sh   # the Postgres harness
```

The harness builds a throwaway database, applies every migration, seeds live,
draft, paused and rejected products from an active and a suspended vendor, and
tests visibility, the item shape, search, every sort, cursor paging, filters,
related products, the store, the sitemap, privileges, `EXPLAIN` index use at
20,000 products, the rollback, and every earlier harness unchanged.
