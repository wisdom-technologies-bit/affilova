# Blog and support tickets: hidden for launch

The blog (`/blog`, `/api/blog/*`, the admin blog editor and comments) and the
support ticket form (`/api/support/tickets`) belonged to the removed legacy
system. They are **hidden for launch**:

- `/blog`, `/blog/*` and `/admin/*` answer 404; there is no link to the blog
  anywhere on the public site, and it is not in the sitemap.
- `/contact` is plain content: the support email from `LEGAL.supportEmail`
  (shown as a `mailto:` link only when set) and links to existing help pages.
  It has no form and no database dependency.

## After launch

Both will be rebuilt on Supabase (tables with RLS, server actions behind the
existing roles, Turnstile on anonymous forms) instead of the old Neon tables.
The admin host already has placeholder pages at `app/hosts/admin/blog` and
`app/hosts/admin/support` to build on. Until then nothing in the kept system
reads or writes blog or ticket data.
