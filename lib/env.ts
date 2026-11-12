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

const requiredUrl = z.preprocess(
  present,
  z.string({ required_error: "is required" }).url("must be a valid URL, e.g. https://example.com"),
)

const optionalUrl = z.preprocess(
  present,
  z.string().url("must be a valid URL, e.g. https://example.com").optional(),
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
})

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: requiredString,
  CRON_SECRET: z.preprocess(
    present,
    z
      .string({ required_error: "is required" })
      .min(32, "must be at least 32 characters long"),
  ),
  // Optional for now; required once the feature that uses them ships.
  PAYSTACK_SECRET_KEY: optionalString,
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
  // Legacy variables, to be removed once the replacements above are in use.
  DATABASE_URL: optionalUrl,
  JWT_SECRET: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  SQUAD_SECRET_KEY: optionalString,
  SQUAD_PUBLIC_KEY: optionalString,
})

export type PublicEnv = z.infer<typeof publicEnvSchema>
export type ServerEnv = z.infer<typeof serverEnvSchema>

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

let serverEnvCache: ServerEnv | undefined
let publicEnvCache: PublicEnv | undefined

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
    })
  }

  return publicEnvCache
}
