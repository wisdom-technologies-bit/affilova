# The catalog: products, files and images

A vendor creates a digital product, uploads the private file behind it, adds
images, submits it for review, and a member of staff publishes it. This document
is the reference for the rules the database enforces; the code that calls them is
in `lib/catalog/`, `lib/storage/r2.ts` and `lib/images/cloudinary.ts`.

## The short version

- The private file lives in a **Cloudflare R2** bucket. It is never public and is
  only ever reached through a signed link that expires.
- Product images live in **Cloudinary**.
- **No client writes a catalog table.** A vendor reads their own rows; staff read
  all of them; every write goes through a `SECURITY DEFINER` function that only
  the service role may execute, called from a server action.
- The server action always takes the actor from the session and passes it as
  `p_actor`. A vendor id in the request body is ignored.

## The state machine

Statuses: `draft`, `submitted`, `live`, `paused`, `rejected`, `archived`.

| Action        | Who                   | From                     | To          | Notes |
| ------------- | --------------------- | ------------------------ | ----------- | ----- |
| `submit`      | the vendor who owns it | `draft`, `rejected`     | `submitted` | Refused with `not_ready` while anything is missing; clears `reject_reason`; stamps `submitted_at`. |
| `withdraw`    | the vendor who owns it | `submitted`             | `draft`     | The only way to edit while under review. |
| `pause`       | the vendor who owns it | `live`                   | `paused`    | Takes it off sale without losing its address. |
| `resume`      | the vendor who owns it | `paused`                 | `live`      | |
| `archive`     | the vendor who owns it | `draft`, `rejected`, `paused` | `archived` | Final for the vendor: an archived product cannot be edited, and no files or images may be added. |
| `approve`     | admin or moderator     | `submitted`              | `live`      | Stamps `published_at`, `reviewed_by`, `reviewed_at`. |
| `reject`      | admin or moderator     | `submitted`              | `rejected`  | A reason of at least 10 characters is required. |
| `staff_pause` | admin or moderator     | `live`                   | `paused`    | A reason of at least 10 characters is required. |

Anything else is refused with `bad_state`, and every transition writes an
`audit_log` row with the previous and the next status, plus the reason when there
is one.

**Nobody reviews their own product.** A staff member who also owns a product gets
`self_review` from `approve` and `reject`, whatever their role.

### Editing

| Status      | May the vendor edit? | Notes |
| ----------- | -------------------- | ----- |
| `draft`     | yes                  | Including the address (slug). |
| `rejected`  | yes                  | Then submit again. |
| `submitted` | **no**               | Withdraw first, so a reviewer never approves something that changes under them. |
| `live`      | yes, audited         | Price, commission, title, description, refund window and download allowance may change. The slug may **not**: a shared address cannot be taken over. |
| `paused`    | yes                  | The slug is still frozen once `published_at` is set. |
| `archived`  | no                   | |

Every edit writes a `product.updated` audit row containing only the fields that
actually changed, with the old and the new value.

### Readiness

Submit is refused until all of these hold:

- a title of 3 to 120 characters
- a short description of 10 to 200 characters
- a description of **at least 80 characters**
- a category
- a price between ₦100 and ₦10,000,000
- a commission inside the range in `public.settings`
- at least one **uploaded** file
- a cover image

`get_product_readiness` returns each flag plus a `missing` array in that order.

## Files

The bytes are private, in R2. What the product owns is a row in
`public.product_files` created *before* the upload and confirmed *after* it.

| Rule | Value |
| ---- | ----- |
| Largest single file | 2 GiB (2,147,483,648 bytes) |
| Files per product | 10 |
| Total size per product | 5 GiB, counting pending and uploaded rows |
| Upload style | a single signed `PUT` up to 100 MiB, multipart above that |
| Part size | 16 MiB |
| Signed PUT lifetime | 15 minutes |
| Signed part lifetime | 60 minutes |
| Download link lifetime | 5 minutes |

### Allowed types

The **extension decides the content type**; a browser-supplied MIME type is
ignored. Anything not in this list is refused with `not_allowed_type`:

`pdf` `epub` `mobi` `zip` `7z` `rar` `mp4` `mov` `mp3` `wav` `m4a` `docx` `xlsx`
`pptx` `txt` `csv` `png` `jpg` `jpeg` `psd` `ai` `eps` `ttf` `otf`

A double extension whose inner part is executable (`invoice.exe.pdf`) is refused
with `double_extension`. File names are sanitized before they are stored: any
directory part and control characters are removed, leading dots go, spaces are
collapsed and the name is cut to 120 characters with the extension kept.

### The storage key

```
products/<product id>/<file id>/<sanitized name>
```

`register_product_file` checks that prefix against the product and the file id it
was given, and refuses a mismatch with `key_mismatch`. Without that check a vendor
could point a row at another product's object.

### Sizes and the upload handshake

1. `startFileUploadAction` validates the name and the claimed size, generates the
   file id, builds the key, reserves the row and returns either one signed `PUT`
   or a multipart plan with the upload id and a signed URL per part.
2. The browser uploads straight to R2.
3. `confirmFileUploadAction` (single) or `completeMultipartAction` (multipart)
   **heads the object** and compares its real size with the reservation. A
   mismatch deletes the object and the row and answers `size_mismatch`, because
   the claimed size is not evidence of anything.
4. Only then is the row `uploaded`, which is what readiness counts.

`deleteFileAction` deletes the **row first**, then the object (a `last_file`
refusal leaves both in place). A live or submitted product may not lose its last
uploaded file.

Abandoned reservations are swept by the daily `storage_cleanup` job: see
`docs/cron.md`.

## Images

Six per product, in Cloudinary, verified through the Admin API after upload.

| Rule | Value |
| ---- | ----- |
| Images per product | 6 |
| Largest image | 5 MB |
| Shortest side | 400 px |
| Formats | `jpg`, `jpeg`, `png`, `webp` |
| Covers per product | exactly 1 |

The browser uploads directly with a signature made by `signImageUploadAction`
(the signature covers `timestamp`, `folder` and `allowed_formats`). The server
then looks the asset up and deletes it if it is too large, the wrong format, or
too small. The first image added becomes the cover; removing the cover promotes
the image with the lowest `sort`.

## The R2 bucket

The bucket is **private**. No public bucket URL, no custom domain, no
`public-read`. Signed links are the only access path.

The browser uploads straight to R2, so the bucket needs a CORS rule that allows
the app origins to `PUT` (and `GET` for a resumed part):

```json
[
  {
    "AllowedOrigins": ["https://<app host>"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ETag` must be exposed: the browser needs it to finish a multipart upload. Without
this rule the browser upload fails before the server ever sees a request.

## Environment variables

Read only through `lib/env.ts`, and only when the feature is used, so a deployment
without them still builds and still serves everything that does not upload a file.

| Variable | Used for |
| -------- | -------- |
| `R2_ACCOUNT_ID` | The R2 endpoint, `https://<account>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | Signing uploads and downloads |
| `R2_SECRET_ACCESS_KEY` | Signing uploads and downloads |
| `R2_BUCKET_FILES` | The private files bucket |
| `CLOUDINARY_CLOUD_NAME` | The image account |
| `CLOUDINARY_API_KEY` | Direct uploads from the browser |
| `CLOUDINARY_API_SECRET` | Signing those uploads and reading assets back |

## Launch decisions

These are deliberate for this stage, not gaps that were forgotten.

- **Edits to a live product are allowed and audited.** Versioned review (edit,
  then re-review before the change goes live) is a later task. Until then the
  audit trail with before and after values is what makes the change visible and
  attributable.
- **Malware scanning is not implemented.** `scan_status` stays `not_scanned`, and
  nothing in the app claims a file was scanned. Until a scanning provider is
  chosen, the control is the audited admin download
  (`product.file.admin_download`, written before the link is created) plus the
  extension allow-list above, which makes a stored file non-executable by type.
- **Only vendors with an active role can create products.** Both an active
  `vendor` role and an active `vendor_profiles` row are required, so a suspended
  store keeps its history but cannot create anything new.

## Errors

Functions raise a short code as the message; `lib/catalog/errors.ts` turns it into
one sentence and answers `Something went wrong. Please try again.` for anything it
does not recognise. Raw database text never reaches a browser.

`forbidden` and `not_found` are deliberately separate: another vendor's product
answers `forbidden`, which does not confirm that the id exists.
