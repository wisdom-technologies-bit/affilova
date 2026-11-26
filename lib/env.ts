import { z } from "zod"

// Environment variables are read lazily, on first call to getServerEnv() or
// getPublicEnv(). Nothing is parsed at import time, so a missing variable can
// never break a build or a module import: only the code path that needs the
// value fails, with an error naming every variable that is missing or invalid.

export type EnvSource = Record<string, string | undefined>

const PUBLIC_APP_ENVS = ["development", "preview", "production"] as const

// Trims the value and treats blank strings as absent, so an empty placeholder
// in a .env file reads the same as a variable that was never set.
function present(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed === "" ? undefined : trimmed
}

const requiredString = z.preprocess(
  present,
  z.string({ required_error: "is required" }).min(1, "must not be empty"),
)

const optionalString = z.preprocess(present, z.string().min(1, "must not be empty").optional())

// "true" and "false" become booleans; absent or blank becomes undefined, so a
// variable that is not set reads the same as one left empty.
const optionalBoolean = z.preprocess(
  present,
  z
    .enum(["true", "false"], {
      invalid_type_error: "must be true or false",
    })
    .transform((value) => value === "true")
    .optional(),
)

const requiredUrl = z.preprocess(
  present,
  z.string({ required_error: "is required" }).url("must be a valid URL, e.g. https://example.com"),
)

const hostName = z.preprocess(
  present,
  z
    .string({ required_error: "is required" })
    .min(1, "must not be empty")
    .refine(
      (value) => !value.includes("://") && !value.includes("/"),
      "must be a host name without a protocol or path, e.g. app.example.com",
    ),
)

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.preprocess(
    present,
    z.enum(PUBLIC_APP_ENVS, {
      required_error: "is required",
      invalid_type_error: `must be one of ${PUBLIC_APP_ENVS.join(", ")}`,
    }),
  ),
  NEXT_PUBLIC_APP_URL: requiredUrl,
  NEXT_PUBLIC_HOST_PUBLIC: hostName,
  NEXT_PUBLIC_HOST_AFFILIATE: hostName,
  NEXT_PUBLIC_HOST_MERCHANT: hostName,
  NEXT_PUBLIC_HOST_ACCOUNT: hostName,
  NEXT_PUBLIC_HOST_ADMIN: hostName,
  NEXT_PUBLIC_SUPABASE_URL: requiredUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString,
  // Optional: cookies stay on the exact host when this is empty (vercel.app).
  NEXT_PUBLIC_COOKIE_DOMAIN: optionalString,
  // Optional for now; required once the feature that uses them ships.
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: optionalString,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
  // Optional: without it every Sentry call is a no-op and nothing is reported.
  NEXT_PUBLIC_SENTRY_DSN: optionalString,
})

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: requiredString,
  CRON_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
  // The documented break-glass switch for staff two-factor sign-in. Absent means
  // "enforced", except in development, where it means "not enforced" so a
  // developer without an authenticator can still work. Set it to "false" in
  // Vercel to turn enforcement off during an incident, then set it back.
  STAFF_MFA_ENFORCE: optionalBoolean,
  // Optional for now; required once the feature that uses them ships.
  PAYSTACK_SECRET_KEY: optionalString,
  // Optional here so a deployment that never sends an access link still builds;
  // required, at least 32 characters, by getOrderAccessSecret().
  ORDER_ACCESS_SECRET: optionalString,
  // Optional here so a deployment without payouts still builds; required, at
  // least 32 characters, by getStepUpSecret().
  STEP_UP_SECRET: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_FILES: optionalString,
  BREVO_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  EMAIL_REPLY_TO: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
})

export type PublicEnv = z.infer<typeof publicEnvSchema>
export type ServerEnv = z.infer<typeof serverEnvSchema>

// The private file bucket. Read only by lib/storage/r2.ts, and only when a
// signed URL is actually being made, so a deployment without R2 configured can
// still build, run its tests and serve everything that does not upload a file.
const r2EnvSchema = z.object({
  R2_ACCOUNT_ID: requiredString,
  R2_ACCESS_KEY_ID: requiredString,
  R2_SECRET_ACCESS_KEY: requiredString,
  R2_BUCKET_FILES: requiredString,
})

// The image account. Read only by lib/images/cloudinary.ts.
const cloudinaryEnvSchema = z.object({
  CLOUDINARY_CLOUD_NAME: requiredString,
  CLOUDINARY_API_KEY: requiredString,
  CLOUDINARY_API_SECRET: requiredString,
})

// The separate scanner service. Read only by lib/scanning/client.ts and by the
// signed callback route, and never at import time: a deployment without a
// scanner configured can still build and run everything that does not scan.
const scannerEnvSchema = z.object({
  SCANNER_URL: requiredUrl,
  SCANNER_SHARED_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
  SCANNER_CALLBACK_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
})

// Affiliate click tracking. Read only by lib/tracking/hash.ts, and only when a
// click is actually being hashed: a deployment that never serves a tracked link
// still builds and still runs everything else.
//
// The secret is what makes the daily salt unguessable, so a stored hash cannot be
// reversed by hashing a guessed address against a known day. At least 32
// characters, because a short secret is a short dictionary.
const trackingEnvSchema = z.object({
  CLICK_HASH_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
})

export type TrackingEnv = z.infer<typeof trackingEnvSchema>

// Paystack. Read only by lib/paystack/client.ts and by the webhook route, and
// only when a payment is actually being made or a webhook is being checked: a
// deployment with no Paystack key still builds and still serves every page that
// does not take money.
//
// The mode is derived from the secret key prefix, never configured: a live key
// in a test deployment is a real charge, and a test key in production takes no
// money at all. Both are worth seeing on the page rather than guessing.
const paystackEnvSchema = z.object({
  PAYSTACK_SECRET_KEY: requiredString,
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: optionalString,
  // The signing secret for the newer Paystack-Signature header (whsec_...).
  // Optional: without it only the legacy x-paystack-signature header is checked.
  PAYSTACK_WEBHOOK_SECRET: optionalString,
  // "true" turns the source IP allowlist on. Anything else, or nothing, leaves
  // it off and only logs a warning for an unexpected address.
  PAYSTACK_WEBHOOK_ENFORCE_IPS: optionalString,
  // The secret path segment of the transfer approval URL. Paystack documents no
  // signature on that request, so the URL itself is the credential: at least 32
  // characters of randomness, compared in constant time. Optional here so a
  // deployment that has not configured approval still builds; the route answers
  // 404 for every token when it is absent.
  PAYSTACK_TRANSFER_APPROVAL_TOKEN: z.preprocess(
    present,
    z
      .string()
      .min(32, "must be at least 32 characters long")
      .regex(/^[A-Za-z0-9_-]+$/, "must be URL-safe: letters, digits, dash or underscore")
      .optional(),
  ),
})

export type PaystackMode = "test" | "live" | "invalid"

export interface PaystackEnv {
  PAYSTACK_SECRET_KEY: string
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?: string
  PAYSTACK_WEBHOOK_SECRET?: string
  /** The secret path segment of the transfer approval URL, when configured. */
  PAYSTACK_TRANSFER_APPROVAL_TOKEN?: string
  /** test for sk_test_, live for sk_live_, invalid for anything else. */
  mode: PaystackMode
  /** Whether the webhook route refuses addresses outside Paystack's list. */
  enforceWebhookIps: boolean
}

// The secret that signs a buyer's download link. Deliberately separate from
// every other secret: rotating it invalidates links and nothing else.
const orderAccessSecretSchema = z.object({
  ORDER_ACCESS_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
})

// Email. Read only by lib/email/*, and only when a message is sent or when the
// Security page asks what is configured.
//
// Every field is optional here so a deployment without Brevo still builds, still
// renders the Security page and still runs every test. A missing key is a state
// the diagnostics report, not a parse error: that is the whole point of
// getEmailConfigHealth in lib/email/health.ts.
const emailEnvSchema = z.object({
  BREVO_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  EMAIL_REPLY_TO: optionalString,
  ORDER_ACCESS_SECRET: optionalString,
  STEP_UP_SECRET: optionalString,
})

export type EmailEnv = z.infer<typeof emailEnvSchema>

// The secret that keys the HMAC of a step-up code. Deliberately separate from
// every other secret: rotating it voids unused codes and nothing else.
const stepUpSecretSchema = z.object({
  STEP_UP_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
})

export type R2Env = z.infer<typeof r2EnvSchema>
export type CloudinaryEnv = z.infer<typeof cloudinaryEnvSchema>
export type ScannerEnv = {
  /** Parsed, because it is joined with a path before every request. */
  SCANNER_URL: URL
  SCANNER_SHARED_SECRET: string
  SCANNER_CALLBACK_SECRET: string
}

function formatIssues(scope: string, error: z.ZodError): string {
  const details = error.issues.map((issue) => {
    const name = issue.path.length > 0 ? issue.path.join(".") : "(root)"

    return `  ${name}: ${issue.message}`
  })

  return `Invalid ${scope} environment variables:\n${details.join("\n")}`
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  const result = publicEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("public", result.error))
  }

  return result.data
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("server", result.error))
  }

  return result.data
}

export function parseR2Env(source: EnvSource): R2Env {
  const result = r2EnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("R2", result.error))
  }

  return result.data
}

export function parseCloudinaryEnv(source: EnvSource): CloudinaryEnv {
  const result = cloudinaryEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("Cloudinary", result.error))
  }

  return result.data
}

export function parseTrackingEnv(source: EnvSource): TrackingEnv {
  const result = trackingEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("click tracking", result.error))
  }

  return result.data
}

export function parseScannerEnv(source: EnvSource): ScannerEnv {
  const result = scannerEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("scanner", result.error))
  }

  return {
    SCANNER_URL: new URL(result.data.SCANNER_URL),
    SCANNER_SHARED_SECRET: result.data.SCANNER_SHARED_SECRET,
    SCANNER_CALLBACK_SECRET: result.data.SCANNER_CALLBACK_SECRET,
  }
}

export function paystackMode(secretKey: string): PaystackMode {
  if (secretKey.startsWith("sk_test_")) {
    return "test"
  }

  if (secretKey.startsWith("sk_live_")) {
    return "live"
  }

  return "invalid"
}

export function parsePaystackEnv(source: EnvSource): PaystackEnv {
  const result = paystackEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("Paystack", result.error))
  }

  const enforce = (result.data.PAYSTACK_WEBHOOK_ENFORCE_IPS ?? "").toLowerCase()

  return {
    PAYSTACK_SECRET_KEY: result.data.PAYSTACK_SECRET_KEY,
    ...(result.data.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY === undefined
      ? {}
      : { NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: result.data.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY }),
    ...(result.data.PAYSTACK_WEBHOOK_SECRET === undefined
      ? {}
      : { PAYSTACK_WEBHOOK_SECRET: result.data.PAYSTACK_WEBHOOK_SECRET }),
    ...(result.data.PAYSTACK_TRANSFER_APPROVAL_TOKEN === undefined
      ? {}
      : { PAYSTACK_TRANSFER_APPROVAL_TOKEN: result.data.PAYSTACK_TRANSFER_APPROVAL_TOKEN }),
    mode: paystackMode(result.data.PAYSTACK_SECRET_KEY),
    enforceWebhookIps: enforce === "true" || enforce === "1" || enforce === "yes",
  }
}

export function parseEmailEnv(source: EnvSource): EmailEnv {
  const result = emailEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("email", result.error))
  }

  return result.data
}

export function parseOrderAccessSecret(source: EnvSource): string {
  const result = orderAccessSecretSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("access link", result.error))
  }

  return result.data.ORDER_ACCESS_SECRET
}

export function parseStepUpSecret(source: EnvSource): string {
  const result = stepUpSecretSchema.safeParse(source)

  if (!result.success) {
    throw new Error(formatIssues("step-up code", result.error))
  }

  return result.data.STEP_UP_SECRET
}

let serverEnvCache: ServerEnv | undefined
let publicEnvCache: PublicEnv | undefined

/**
 * Whether a staff account must complete a second factor.
 *
 * The explicit setting wins. Without it, production and preview enforce and
 * development does not, so a fresh clone is usable and a deployed build is not
 * open. This is the break-glass switch documented in docs/staff-security.md.
 */
export function resolveStaffMfaEnforced(configured: boolean | undefined, appEnv: string): boolean {
  if (configured !== undefined) {
    return configured
  }

  return appEnv !== "development"
}

export function staffMfaEnforced(): boolean {
  // Read directly rather than through the strict schemas, so a build that is
  // missing an unrelated variable still answers this question instead of
  // throwing on the way into the admin app. A build with no NEXT_PUBLIC_APP_ENV
  // is treated as a development build, which is how the rest of the app already
  // treats one (see resolveAppOverride in lib/host-routing.ts).
  const raw = present(process.env.STAFF_MFA_ENFORCE)
  const configured = raw === "true" ? true : raw === "false" ? false : undefined
  const appEnv = present(process.env.NEXT_PUBLIC_APP_ENV) ?? "development"

  return resolveStaffMfaEnforced(configured, appEnv)
}

export function getServerEnv(): ServerEnv {
  if (!serverEnvCache) {
    serverEnvCache = parseServerEnv(process.env)
  }

  return serverEnvCache
}

export function getPublicEnv(): PublicEnv {
  if (!publicEnvCache) {
    // Next.js only inlines literal process.env.NEXT_PUBLIC_* references, so
    // every public variable is listed here by name.
    publicEnvCache = parsePublicEnv({
      NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_HOST_PUBLIC: process.env.NEXT_PUBLIC_HOST_PUBLIC,
      NEXT_PUBLIC_HOST_AFFILIATE: process.env.NEXT_PUBLIC_HOST_AFFILIATE,
      NEXT_PUBLIC_HOST_MERCHANT: process.env.NEXT_PUBLIC_HOST_MERCHANT,
      NEXT_PUBLIC_HOST_ACCOUNT: process.env.NEXT_PUBLIC_HOST_ACCOUNT,
      NEXT_PUBLIC_HOST_ADMIN: process.env.NEXT_PUBLIC_HOST_ADMIN,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_COOKIE_DOMAIN: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    })
  }

  return publicEnvCache
}

// Deliberately uncached and unparsed until called: this is the only place that
// learns whether the storage and image credentials exist.
export function getR2Env(): R2Env {
  return parseR2Env({
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_FILES: process.env.R2_BUCKET_FILES,
  })
}

// Deliberately uncached, like the storage credentials: the scanner is optional
// for every code path that does not scan a file.
export function getScannerEnv(): ScannerEnv {
  return parseScannerEnv({
    SCANNER_URL: process.env.SCANNER_URL,
    SCANNER_SHARED_SECRET: process.env.SCANNER_SHARED_SECRET,
    SCANNER_CALLBACK_SECRET: process.env.SCANNER_CALLBACK_SECRET,
  })
}

// Deliberately uncached: only a tracked link needs it, and a missing secret must
// not break a build or an unrelated page.
export function getTrackingEnv(): TrackingEnv {
  return parseTrackingEnv({
    CLICK_HASH_SECRET: process.env.CLICK_HASH_SECRET,
  })
}

export function getCloudinaryEnv(): CloudinaryEnv {
  return parseCloudinaryEnv({
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  })
}

// Deliberately uncached, like the storage credentials: only a payment path or a
// webhook needs it, and a missing key must not break a build.
export function getPaystackEnv(): PaystackEnv {
  return parsePaystackEnv({
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
    PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET,
    PAYSTACK_WEBHOOK_ENFORCE_IPS: process.env.PAYSTACK_WEBHOOK_ENFORCE_IPS,
    PAYSTACK_TRANSFER_APPROVAL_TOKEN: process.env.PAYSTACK_TRANSFER_APPROVAL_TOKEN,
  })
}

// Deliberately uncached, like the storage credentials: the email settings are
// read when a message is sent and when the Security page is opened, and a
// deployment without them must still build.
export function getEmailEnv(): EmailEnv {
  return parseEmailEnv({
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO,
    ORDER_ACCESS_SECRET: process.env.ORDER_ACCESS_SECRET,
    STEP_UP_SECRET: process.env.STEP_UP_SECRET,
  })
}

// The access-link secret, read only when a link is signed or verified, and
// never at import time. A missing or short secret is an error, not a default.
export function getOrderAccessSecret(): string {
  return parseOrderAccessSecret({
    ORDER_ACCESS_SECRET: process.env.ORDER_ACCESS_SECRET,
  })
}

// The step-up secret, read only when a code is made or checked, and never at
// import time. A missing or short secret is an error, not a default.
export function getStepUpSecret(): string {
  return parseStepUpSecret({
    STEP_UP_SECRET: process.env.STEP_UP_SECRET,
  })
}
