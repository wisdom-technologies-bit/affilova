# Roles and onboarding

How Affilova decides what a signed-in person may do, and how somebody becomes a
vendor or an affiliate.

Three pieces, kept apart on purpose:

| Piece | File | Decides |
| --- | --- | --- |
| The rulebook | `lib/identity/permissions.ts` | Which roles may do which action. Pure: no Next.js, no Supabase. |
| The guards | `lib/identity/guards.ts` | How a page or a route handler applies the rulebook. |
| The grant | `supabase/migrations/20261113000100_roles_onboarding.sql` | The only way a role is given to somebody. |

## The seven roles

`customer`, `affiliate`, `vendor`, `admin`, `finance`, `support`, `moderator`.

Every account has `customer` from the moment it is created: the signup trigger in
the foundation migration inserts it. A person can also hold `affiliate`, `vendor`,
or both. The last four are staff roles and are granted by hand.

## The permission matrix

`can(roles, action)` is true when at least one of the roles the person holds
grants the action.

| Action | customer | affiliate | vendor | admin | finance | support | moderator |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `area:account` | yes | yes | yes | yes | yes | yes | yes |
| `area:affiliate` | | yes | | | | | |
| `area:merchant` | | | yes | | | | |
| `area:admin` | | | | yes | yes | yes | yes |
| `products:review` | | | | yes | | | yes |
| `tickets:read` | | | | yes | | yes | |
| `payouts:approve` | | | | yes | yes | | |
| `vat:manage` | | | | yes | yes | | |
| `settings:read` | | | | yes | yes | yes | yes |
| `settings:write` | | | | yes | yes | | |
| `users:suspend` | | | | yes | | | |
| `roles:grant` | | | | yes | | | |

Two rules that the matrix follows and the tests protect:

- **A role never implies another.** `admin` may approve payouts because
  `payouts:approve` lists `admin`, not because admin inherits finance. If a role
  is taken away from an action, it loses it.
- **An unknown action is denied.** `can()` checks the matrix at runtime as well
  as in the types, so a value that arrives from stored data fails closed instead
  of throwing.

`area:account` is listed for every role because it means "signed in at all", and
`customer` is the role a brand-new account holds.

## Using the guards

### In a page

```ts
import { requirePermission } from "@/lib/identity/guards"

export default async function SettingsPage() {
  const { user, roles } = await requirePermission("settings:read", "/admin/settings")

  // user and roles are guaranteed here.
}
```

`requireUser(nextPath)` is the same thing without a permission check, for pages
any signed-in person may see.

Both take the path they are protecting. A signed-out visitor is redirected to
`/sign-in?next=<encoded path>`, so they come back to where they were going. The
path goes through `safeNextPath()` first, so a crafted value cannot turn that
redirect into an open redirect.

When a signed-in person lacks the permission, the third argument decides what
happens:

| `onDenied` | Result |
| --- | --- |
| `"not-found"` (default) | `notFound()`: the page does not reveal that it exists. |
| `"start"` | `redirect("/start")`: send them to choose a role. |

A guard never returns when the answer is no. `redirect()` and `notFound()` throw,
which is what stops the page body from rendering.

### In a route handler

```ts
import { apiRequirePermission } from "@/lib/identity/guards"

export async function POST() {
  const access = await apiRequirePermission("settings:write")

  if (!access.ok) {
    return access.response
  }

  // access.user and access.roles are guaranteed here.
}
```

`apiRequirePermission` does not redirect. It returns
`{ error: "Unauthorized" }` with status 401 when nobody is signed in, and
`{ error: "Forbidden" }` with status 403 when somebody is signed in without the
permission.

## How a role is granted

**Only two functions grant a role**, and only the server can call them:

- `public.become_vendor(...)`
- `public.become_affiliate(...)`

Each one, in a single transaction:

1. refuses an inactive or missing profile (`profile_not_active`);
2. returns `{"created": false}` and changes nothing if the person already has
   that profile row;
3. inserts the profile row;
4. upserts the role in `public.user_roles` with status `active`;
5. records acceptance of `terms_of_service` and `privacy_policy` at the current
   policy version in `public.policy_acceptances`;
6. writes one `public.audit_log` row: `role.vendor.granted` or
   `role.affiliate.granted`.

`EXECUTE` on both is revoked from `public`, `anon` and `authenticated` and granted
to `service_role` only, so a signed-in person cannot call them at all, let alone
name somebody else's user id. The app calls them from
`app/start/actions.ts` through the service-role client.

The client never writes these tables. A signed-in person can read their own row
(`vendor_profiles`, `affiliate_profiles`, `policy_acceptances`) and can update a
short list of columns on their own profile row, and nothing else:

| Table | Columns the owner may update |
| --- | --- |
| `vendor_profiles` | `business_name`, `support_email`, `phone` |
| `affiliate_profiles` | `promotion_channels` |
| `policy_acceptances` | none |

The store address and the username are **not** in those lists: once taken, an
owner cannot change theirs, and staff cannot change it from the app either.

**A future admin action** would be the third route. It does not exist yet. When it
is added it must check `roles:grant`, write `public.user_roles`, and write an
`audit_log` row in the same transaction, exactly as the two functions do. The
`user_roles` table has no `INSERT` grant for `authenticated`, so it has to go
through the service role.

## The policy version

`lib/identity/policies.ts` exports `POLICY_VERSION = "draft-2026-11-13"`.

The legal text behind `/terms-of-service` and `/privacy-policy` is **not final and
has not been approved by counsel**. That version string is stored, unchanged, in
`public.policy_acceptances.version`, so acceptances collected now can be told
apart from acceptances of the approved documents later.

When counsel approves the wording, change `POLICY_VERSION`. Do not reuse an
existing value: a new version means a different document, and somebody who
accepted the draft has not accepted the approved text.

## Reserved handles

`public.is_reserved_handle(text)` and `lib/identity/reserved-handles.ts` carry the
same list: words that would look official as a store address or a username
(`admin`, `support`, `sign-in`, `terms`, …), paths the app already serves
(`login`, `dashboard`, `api`), and values that read as a missing field (`null`,
`undefined`).

The database has the final say: the list is a `CHECK` on `vendor_profiles.slug`
and `affiliate_profiles.username`. The TypeScript copy exists so the form can
answer without a round trip, and a test reads the migration and fails if the two
lists drift apart.

## Onboarding pages

| Page | Who may see it |
| --- | --- |
| `/start` | Any signed-in person. Shows which roles the account holds. |
| `/start/vendor` | Signed in, not already a vendor. Redirects to `/start` if they are. |
| `/start/affiliate` | Signed in, not already an affiliate. Same redirect. |

All three are `noindex`. The two forms validate with the shared schemas in
`lib/identity/onboarding-schemas.ts`, which mirror the database constraints, and
the server action returns one message per field. A taken handle becomes a field
error; every other database failure becomes one fixed sentence, so a raw database
message never reaches the browser.
