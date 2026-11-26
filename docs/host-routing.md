# Host routing

Affilova is one Next.js app serving five hosts: the public site, the admin
console, the merchant console, the affiliate console and the account area. Each
of the four app hosts is a separate address, but the code for all of them lives
in a single deployment.

## The five hosts

| app | host | route tree |
| --- | --- | --- |
| `public` | the marketing and storefront address | `app/**`, served as it is |
| `admin` | the staff address | `app/hosts/admin/**` |
| `merchant` | the vendor address | `app/hosts/merchant/**` |
| `affiliate` | the affiliate address | `app/hosts/affiliate/**` |
| `account` | the buyer address | `app/hosts/account/**` |

`lib/hosts.ts` turns the incoming `Host` header into one of those names, and
`lib/host-routing.ts` decides what happens to the path.

## The rewrite

`middleware.ts` runs on every request (the matcher only excludes the build output
and files with an asset extension). It sets `x-affilova-app` and, on an app host,
`x-affilova-path` to the path the visitor actually typed, then asks
`resolveRoute` what to do with the path:

- `static` and `shared` paths (`/_next/`, `/brand/`, `/api`, `/auth`, `/start`,
  `/two-factor`, the policy pages, the asset files) are served as they are, on
  every host;
- on the public host every other path is served as it is;
- on an app host, `/users` becomes `/hosts/admin/users` (for the admin host), and
  the visitor's address bar keeps showing `/users`.

The `/hosts/*` tree is therefore an **internal** tree. `resolveRoute` returns
`not-found` for any request whose path starts with `/hosts`, so the tree cannot
be reached by typing the URL, on any host. Only a rewrite reaches it.

## The rule for links

**A link target is always the path the visitor sees, never the path the
middleware rewrites to.** Inside `app/hosts/<app>`, write `/users`, `/products`,
`/finance`, `/`, exactly as the address bar will show it:

```tsx
// right: the admin host serves this at /users
<Link href="/users">Users</Link>
<Link href={`/users/${row.id}`}>{row.name}</Link>

// wrong: /hosts/admin/users is the internal tree and 404s
<Link href="/hosts/admin/users">Users</Link>
```

The same rule holds for `redirect(...)` from `next/navigation`, for
`router.push` and `router.replace`, and for any helper that builds a link, which
is where this went wrong once: a pagination helper returned
`/hosts/admin/users?page=2` and every filter and page link on the screen led to a
404 while the first page loaded fine.

`revalidatePath` and `revalidateTag` are the exception. They take the route the
app renders, not the address the visitor sees, so a cache invalidation in
`lib/` names `/hosts/admin/users` on purpose.

## The guard

`tests/host-link-targets.test.ts` reads every `.ts` and `.tsx` file in `app/`,
`components/` and `lib/` (skipping `*.test.ts`, `*.test.tsx` and
`lib/host-routing.ts`), parses it with the TypeScript parser and fails on any
string or template literal that starts with `/hosts/`.

- In `app/` and `components/`, any such literal fails: a page or a component has
  no reason to name the internal tree, and a helper that returns one is a link
  target even when the parser cannot see the call that consumes it.
- In `lib/`, the literal is allowed only as the argument of `revalidatePath` or
  `revalidateTag`.

The scan goes through the parser rather than a text search, so a path mentioned
in a comment is ignored, and the test has its own cases for the shapes the rule
covers, for the helper that caused the bug, and for the two exemptions.

## Adding a screen

1. Put the page in `app/hosts/<app>/<segment>/page.tsx`.
2. Link to it with the visible path, `/<segment>`.
3. Add the navigation entry in `components/app-shell/navigation.ts` with the same
   visible path; `shellPath` strips the prefix on the server so the current item
   matches.
4. If the screen needs a cache invalidation, call `revalidatePath` with the full
   internal path, `/hosts/<app>/<segment>`.
