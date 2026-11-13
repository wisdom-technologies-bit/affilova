# Database migrations

Short guide for running the SQL in this folder. No programming needed, but the
steps are exact: please follow them in order.

## What a migration file is

Each file in `supabase/migrations/` is a set of database instructions. Running it
once sets up that part of the database. Running it twice is safe: the files are
written to skip anything that already exists.

## Before you start

- Use the **STAGING** Supabase project. Never the production project.
- You need to be signed in to Supabase with access to that project.
- The SQL must be run in the Supabase **SQL Editor**, which runs as the project's
  `postgres` role. That role is allowed to change the database; ordinary app users
  are not.

## Before you run: check the extensions

The migration expects the `citext` and `pg_trgm` extensions to be either missing or
installed in the `extensions` schema. Check that first.

1. In **SQL Editor**, open a **New query**.
2. Paste this and click **Run**:

```sql
select extname, extnamespace::regnamespace as schema
from pg_extension
where extname in ('citext','pg_trgm');
```

3. Read the result. It must be **either**:

   - **no rows** (neither extension is installed yet: the migration will add both
     to the `extensions` schema), **or**
   - **both rows with `schema` = `extensions`**.

If either row shows any other schema (for example `public`), **stop**. Do not run
the migration. Send the query result to the project lead, because the extensions
have to be moved by someone with database access first.

## Step 1: run the migration

1. Open <https://supabase.com/dashboard> and pick the **staging** project.
2. In the left sidebar, click **SQL Editor**, then **New query**.
3. Open the file `supabase/migrations/20261112000100_foundation.sql` from the
   repository, copy **all** of it, and paste it into the editor.
4. Click **Run** (or press Ctrl/Cmd + Enter).
5. You should see **"Success. No rows returned."** A few "already exists,
   skipping" notices are normal and harmless.
6. Optional second run: click **Run** a second time to prove it is repeatable. It
   must also succeed with no red error.

If you get a red error, stop and send the whole error message back. Do not try to
fix it by editing the SQL yourself.

## Step 2: check that it worked

1. In **SQL Editor**, open a **New query**.
2. Copy all of `supabase/verify/20261112000100_foundation_verify.sql` and paste it.
3. Click **Run**.
4. The editor shows one small result table per check, each with a `check_name` and
   a `passed` column.
5. **Every `passed` must be `t` (true).** If even one is `f` (false), the migration
   did not apply correctly: stop and report which check is false.

This check file only reads the database. It changes nothing.

## Step 3: what got created

- `profiles`: one row per signed-up user (name, phone, avatar, verification level,
  account status).
- `user_roles`: what each user is allowed to be (customer, affiliate, vendor,
  admin, finance, support, moderator).
- `settings` and `settings_history`: platform-wide settings and a record of every
  change to them.
- `audit_log`: an append-only record of important actions. Rows can be added but
  never edited, deleted or emptied.
- `app_migrations`: the list of migrations already applied.
- A trigger on Supabase's own `auth.users` table that creates the profile and the
  customer role automatically when someone signs up.

The financial values seeded into `settings` (platform fee, hold days, VAT, minimum
withdrawal and so on) are **placeholders**. They are not approved business terms
and still need a decision from the owner.

## How to roll back

The bottom of the migration file contains a **commented-out rollback block** (every
line starts with `--`).

1. Open a new query in the SQL Editor.
2. Copy the block from the `BEGIN;` line through the final `COMMIT;` line, then
   delete the leading `--` and the space from every one of those lines, so it
   becomes runnable SQL. (Do not copy the lines above `BEGIN;`: they are only
   explanation.)
3. Read it before running it: it **drops all the tables this migration created, and
   all data in them**. On staging that is fine; on production it is a data loss.
4. Click **Run**, then re-run the migration file if you need the tables back.

The `citext` and `pg_trgm` extensions are deliberately left in place by the
rollback, because other things may depend on them.

## The second migration: the job queue (20261112000200_job_queue)

Run this one **after** `20261112000100_foundation.sql` has been applied and every
check in its verify file is `t`. It assumes the foundation is already there.

The steps are the same as above:

1. **Step 1**: copy all of `supabase/migrations/20261112000200_job_queue.sql`
   into a new SQL Editor query and click **Run**. It must succeed, and a second
   **Run** must also succeed.
2. **Step 2**: copy all of
   `supabase/verify/20261112000200_job_queue_verify.sql`, click **Run**, and check
   that every `passed` is `t`. This one has 16 checks.
3. **Step 3**: what it created:
   - `jobs`: the background work queue. One row per piece of work, with its type,
     payload, attempt count and status (`queued`, `running`, `done`, `failed`,
     `dead`).
   - `cron_heartbeats`: one row per scheduled endpoint, recording when it last
     ran, how long it took and whether it worked.
   - Six server-only functions: `enqueue_job`, `claim_jobs`, `complete_job`,
     `fail_job`, `release_job`, `record_heartbeat`. Only the server's service role
     can call them.
   - Staff can **read** both tables in the admin area. Nobody can write to them
     from the app; only the server does, through those functions.

The external scheduler setup is described in `docs/cron.md`. Nothing in this
migration needs a scheduler to be applied.

Its rollback block works the same way as the foundation's. One difference worth
knowing: it drops the **functions before the tables**, because `claim_jobs`
returns the `jobs` row type and the tables cannot be dropped while it exists. If
you edit that block, keep the functions first.

## The third migration: profile names from signup metadata (20261112000300)

Run this one **after** `20261112000100_foundation.sql` has been applied and every
check in its verify file is `t`. It does not depend on the job queue, but the
foundation is required: it replaces the signup trigger function that the
foundation created.

It changes one thing: `public.handle_new_user()`, the function behind the
`auth.users` signup trigger, now also copies `first_name` and `last_name` from
`raw_user_meta_data` into `public.profiles` and builds `display_name` from them.

The steps are the same as above:

1. **Step 1**: copy all of
   `supabase/migrations/20261112000300_profile_names_from_metadata.sql` into a
   new SQL Editor query and click **Run**. It must succeed, and a second **Run**
   must also succeed. It only replaces a function and adds a row to
   `app_migrations`, so it is quick and touches no data.
2. **Step 2**: copy all of
   `supabase/verify/20261112000300_profile_names_verify.sql`, click **Run**, and
   check that every `passed` is `t`. This one has 13 checks.
3. **Step 3**: what it changed:
   - The metadata is treated as untrusted text, because whoever signs up
     supplies it. A missing key, a JSON `null`, or a value that is not a string
     (a number, an object, an array) leaves that name empty instead of raising.
   - Names lose their control characters, are trimmed, and are cut to 100
     characters each.
   - `display_name` is "first last", or whichever of the two is present, or
     `NULL` when neither is.
   - The customer role insert, the `ON CONFLICT DO NOTHING` clauses, and the
     exception block that stops a failure here from blocking a signup are all
     unchanged.

Existing rows are not backfilled: users who signed up before this migration have
no names until they set them. There is no automatic way to recover names from
`auth.users` for those users.

Its rollback block works the same way as the others: strip the leading `-- ` from
every line between `BEGIN;` and `COMMIT;` and run it. It restores the previous
version of `handle_new_user()`, which leaves the three name columns empty for
future signups. It does **not** clear names already copied into `profiles`, and it
deletes no rows.

## Creating the first admin

Every new signup is created as a `customer`. The first admin has to be added by hand,
once:

1. Sign up once in the app on the staging environment, so the user exists.
2. In Supabase, go to **Authentication > Users**, find that user and copy their
   **User UID** (a long UUID like `3f6c...`).
3. In **SQL Editor**, run this, replacing the UUID with theirs:

```sql
-- grant the first admin role (replace the UUID with the user's id from
-- Authentication > Users)
INSERT INTO public.user_roles (user_id, role)
VALUES ('<user uuid>', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
```

4. To check it worked:

```sql
SELECT user_id, role, status
FROM public.user_roles
WHERE role = 'admin';
```

Roles can also be revoked instead of deleted. Update the row's `status` to
`'revoked'` and the role stops counting immediately; set it back to `'active'` to
restore it. Do not delete rows from `user_roles` casually, since the history of who
was granted what is useful.

## Never run SQL on production first

Run every migration on **staging** and confirm every verification check is `t`
before anyone runs it on production. If staging shows an error or a failing check,
production must not be touched.

## File naming

Migration files are named by date and time, so they run in order:
`YYYYMMDDHHMMSS_description.sql`. Each migration has a matching check file in
`supabase/verify/` with the same timestamp and a `_verify.sql` suffix. Never rename
or reorder a migration that has already been applied somewhere.
