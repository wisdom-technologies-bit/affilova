# Staff security

Two things protect a staff account: the role it holds, and a second factor at
sign-in. This document covers the second one: how it is enforced, how a staff
member enrols, what to do when someone loses their phone, and how to switch it
off in an emergency.

The roles that count as staff are `admin`, `finance`, `support` and `moderator`.
A customer, vendor or affiliate is never asked for a second factor.

## How the rule works

Supabase tracks two assurance levels for a session:

- **AAL1** — signed in with a password.
- **AAL2** — signed in with a password *and* a verified second factor in this
  session.

A staff account may only use the admin app at AAL2. The check is
`requireStaffAal2()` in `lib/identity/mfa.ts`, and it is applied in three
places, because any one of them alone can be bypassed:

| Where | What it does |
| --- | --- |
| `app/hosts/admin/layout.tsx` | redirects a page render to enrol or verify |
| `lib/admin/finance-actions.ts`, `lib/ops/actions.ts`, `lib/payouts/actions.ts` | returns `{ ok: false, error: "Two-factor verification required." }` |
| `app/hosts/admin/exports/vat/route.ts` | answers **403** with the same sentence |

The action and route checks exist because a server action and a route handler are
HTTP endpoints of their own. Calling one directly never renders the page that
would have redirected, so the page-level check cannot be the only one.

The order is fixed: the permission guard runs first, then the second factor. A
visitor who may not be in the admin app is sent away without learning anything
about enrolment.

Two decisions, two destinations:

- **no verified factor** → `/two-factor/enroll?next=…`
- **verified factor, but this session is AAL1** → `/two-factor/verify?next=…`

The `next` value is passed through `safeNextPath()` before it is used, so a
crafted link cannot turn the success redirect into an open redirect.

## How a staff member enrols

1. Sign in with the password as usual.
2. The admin app redirects to `/two-factor/enroll`.
3. Scan the QR code with an authenticator app (Google Authenticator, 1Password,
   Authy, …). The same page shows the key for manual entry.
4. Enter the six digit code the app shows. The factor becomes verified and the
   page continues to where they were going.

From then on, every new session needs a code: sign in, then enter the code at
`/two-factor/verify`. Ten attempts per ten minutes are allowed per account.

The secret and the QR code are returned by Supabase to that one page. They are
never stored by our code, never logged, and never put in a URL.

## Break-glass: turning enforcement off

Enforcement is on by default in every environment except `development`. If the
second factor locks the team out (a lost phone for the only admin, a Supabase
outage), the documented switch is:

1. In Vercel, set `STAFF_MFA_ENFORCE` to `false` for the affected environment.
2. Redeploy.
3. Do the work that needs the admin app.
4. Set `STAFF_MFA_ENFORCE` back to `true` (or delete the variable) and redeploy
   again.

Two rules about this switch:

- **It is temporary.** Treat every hour it is off as an incident with a start
  time and an end time.
- **It is not a fix.** If the reason was a lost device, the fix is below; the
  switch only buys the time to do it.

Setting `STAFF_MFA_ENFORCE=true` in `development` is supported too, for testing
the flow locally.

## Lost device: how a staff member gets back in

Supabase has **no recovery codes**. There is no list of one-time codes to keep in
a drawer, so recovery is a second person, by design:

1. Another admin signs in (at AAL2) and opens the staff member's page.
2. They use **Remove two-factor** and confirm. This deletes the user's factors
   through the Supabase admin API and writes an audit row.
3. The staff member signs in with their password and is sent to
   `/two-factor/enroll` to enrol a new device.

If the person who lost the device is the only admin, use the break-glass switch
first, then remove the factor.

> **Deviation from the Feature Standards.** The standards assume recovery codes.
> Supabase's TOTP support does not issue them, so recovery is always "another
> admin removes the factor". That is why the next rule exists.

## There must always be at least two active admins

Recovery depends on a second person. With one admin, a lost phone means the
break-glass switch, and the switch means the admin app is open to anyone with a
password until it is turned back on.

So: **at least two accounts hold the `admin` role at all times**, and both are
enrolled. The database refuses to remove the last active admin's role, and the
check is inside the function, not only in the screen.

## Supabase dashboard check

TOTP enrolment only works when the project has it switched on:

1. Supabase dashboard → **Authentication** → **Providers** (or **Multi-Factor
   Authentication**, depending on the dashboard version).
2. Confirm **TOTP** (Authenticator app) is **enabled**.
3. Confirm the project's rate limits for verification are not set to something
   lower than the ten attempts per ten minutes the app allows.

If TOTP is off, `beginEnrollment()` fails and the enrol page shows its fixed
"sorry, this could not be started" sentence rather than a Supabase message.

## What is never logged

The logger redacts credential-shaped keys and masks email addresses, and on top
of that these are never passed to it at all:

- the TOTP secret;
- the QR code or its data URI;
- a six digit code, correct or not;
- a Supabase auth error message, which can name an internal detail.

A failure is logged as an event name with a short reason (`mfa_enroll_failed`,
`mfa_challenge_failed`), and the person sees one fixed sentence.

## Testing

`lib/identity/mfa.test.ts` covers the whole rule with a fake Supabase client: no
staff role, staff with no factor, staff with a factor at AAL1, staff at AAL2,
enforcement off, and the development default. It also covers the action wrapper
and the route guard, and asserts that a wrapped action is never called when the
session is not good enough.

The sandbox cannot reach a Supabase project, so these tests use fakes by design.
