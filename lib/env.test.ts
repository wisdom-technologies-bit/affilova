import { describe, expect, it } from "vitest"

import {
  getCloudinaryEnv,
  getR2Env,
  getScannerEnv,
  getTrackingEnv,
  parseCloudinaryEnv,
  parseOrderAccessSecret,
  parsePublicEnv,
  parseR2Env,
  parseScannerEnv,
  parseServerEnv,
  parseTrackingEnv,
} from "./env"

const validPublicSource = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.vercel.app",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
}

const validServerSource = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "0123456789abcdef0123456789abcdef",
}

describe("parsePublicEnv", () => {
  it("accepts a complete set of public variables", () => {
    const env = parsePublicEnv(validPublicSource)

    expect(env.NEXT_PUBLIC_APP_ENV).toBe("production")
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://affilova.vercel.app")
    expect(env.NEXT_PUBLIC_HOST_ADMIN).toBe("admin.affilova.vercel.app")
  })

  it("rejects a host name that includes a protocol", () => {
    expect(() =>
      parsePublicEnv({ ...validPublicSource, NEXT_PUBLIC_HOST_PUBLIC: "https://affilova.vercel.app" }),
    ).toThrow(/NEXT_PUBLIC_HOST_PUBLIC/)
  })

  it("rejects an unknown NEXT_PUBLIC_APP_ENV", () => {
    expect(() =>
      parsePublicEnv({ ...validPublicSource, NEXT_PUBLIC_APP_ENV: "staging" }),
    ).toThrow(/NEXT_PUBLIC_APP_ENV/)
  })

  it("reports every missing public variable by name", () => {
    let message = ""

    try {
      parsePublicEnv({})
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("NEXT_PUBLIC_APP_ENV")
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  })

  it("allows the optional public variables to be absent", () => {
    const env = parsePublicEnv(validPublicSource)

    expect(env.NEXT_PUBLIC_COOKIE_DOMAIN).toBeUndefined()
    expect(env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY).toBeUndefined()
    expect(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined()
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined()
  })

  it("accepts an optional Sentry DSN and keeps it as given", () => {
    const dsn = "https://examplePublicKey@o0.ingest.sentry.io/0"

    expect(parsePublicEnv({ ...validPublicSource, NEXT_PUBLIC_SENTRY_DSN: dsn }).NEXT_PUBLIC_SENTRY_DSN).toBe(
      dsn,
    )
  })

  it("treats a blank Sentry DSN as absent", () => {
    expect(
      parsePublicEnv({ ...validPublicSource, NEXT_PUBLIC_SENTRY_DSN: "   " }).NEXT_PUBLIC_SENTRY_DSN,
    ).toBeUndefined()
  })
})

describe("parseServerEnv", () => {
  it("accepts a complete set of server variables", () => {
    const env = parseServerEnv(validServerSource)

    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-key")
    expect(env.CRON_SECRET).toHaveLength(32)
  })

  it("names SUPABASE_SERVICE_ROLE_KEY when it is missing", () => {
    expect(() =>
      parseServerEnv({ ...validServerSource, SUPABASE_SERVICE_ROLE_KEY: undefined }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it("rejects a CRON_SECRET shorter than 32 characters", () => {
    expect(() => parseServerEnv({ ...validServerSource, CRON_SECRET: "too-short" })).toThrow(
      /CRON_SECRET/,
    )
  })

  it("allows the optional server variables to be absent", () => {
    const env = parseServerEnv(validServerSource)

    expect(env.PAYSTACK_SECRET_KEY).toBeUndefined()
    expect(env.R2_ACCOUNT_ID).toBeUndefined()
    expect(env.BREVO_API_KEY).toBeUndefined()
    expect(env.TURNSTILE_SECRET_KEY).toBeUndefined()
    expect(env.CLOUDINARY_API_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.JWT_SECRET).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The storage and image credentials
// ---------------------------------------------------------------------------

const validR2Source = {
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET_FILES: "affilova-files",
}

const validCloudinarySource = {
  CLOUDINARY_CLOUD_NAME: "affilova",
  CLOUDINARY_API_KEY: "api-key",
  CLOUDINARY_API_SECRET: "api-secret",
}

describe("parseR2Env", () => {
  it("reads the four values", () => {
    expect(parseR2Env(validR2Source)).toEqual(validR2Source)
  })

  it("names the variable that is missing", () => {
    for (const key of Object.keys(validR2Source)) {
      expect(() => parseR2Env({ ...validR2Source, [key]: undefined })).toThrow(new RegExp(key))
    }
  })

  it("names the variable that is blank", () => {
    expect(() => parseR2Env({ ...validR2Source, R2_BUCKET_FILES: "   " })).toThrow(
      /R2_BUCKET_FILES/,
    )
  })
})

describe("parseCloudinaryEnv", () => {
  it("reads the three values", () => {
    expect(parseCloudinaryEnv(validCloudinarySource)).toEqual(validCloudinarySource)
  })

  it("names the variable that is missing", () => {
    for (const key of Object.keys(validCloudinarySource)) {
      expect(() => parseCloudinaryEnv({ ...validCloudinarySource, [key]: undefined })).toThrow(
        new RegExp(key),
      )
    }
  })
})

const validScannerSource = {
  SCANNER_URL: "https://scanner.example.com",
  SCANNER_SHARED_SECRET: "0123456789abcdef0123456789abcdef",
  SCANNER_CALLBACK_SECRET: "fedcba9876543210fedcba9876543210",
}

describe("parseScannerEnv", () => {
  it("reads the URL as a URL and the secrets as strings", () => {
    const parsed = parseScannerEnv(validScannerSource)

    expect(parsed.SCANNER_URL).toBeInstanceOf(URL)
    expect(parsed.SCANNER_URL.toString()).toBe("https://scanner.example.com/")
    expect(parsed.SCANNER_SHARED_SECRET).toBe(validScannerSource.SCANNER_SHARED_SECRET)
    expect(parsed.SCANNER_CALLBACK_SECRET).toBe(validScannerSource.SCANNER_CALLBACK_SECRET)
  })

  it("names the variable that is missing", () => {
    for (const key of Object.keys(validScannerSource)) {
      expect(() => parseScannerEnv({ ...validScannerSource, [key]: undefined })).toThrow(
        new RegExp(key),
      )
    }
  })

  it("refuses a URL that is not a URL", () => {
    expect(() => parseScannerEnv({ ...validScannerSource, SCANNER_URL: "scanner" })).toThrow(
      /SCANNER_URL/,
    )
  })

  it("refuses a secret shorter than 32 characters", () => {
    expect(() =>
      parseScannerEnv({ ...validScannerSource, SCANNER_SHARED_SECRET: "a".repeat(31) }),
    ).toThrow(/SCANNER_SHARED_SECRET/)

    expect(() =>
      parseScannerEnv({ ...validScannerSource, SCANNER_CALLBACK_SECRET: "a".repeat(31) }),
    ).toThrow(/SCANNER_CALLBACK_SECRET/)
  })

  it("treats a blank secret as missing", () => {
    expect(() =>
      parseScannerEnv({ ...validScannerSource, SCANNER_SHARED_SECRET: "   " }),
    ).toThrow(/min|at least|required/)
  })
})

describe("the lazy getters", () => {
  it("do not validate anything at import, only when called", () => {
    // Reaching this line at all with no R2 or Cloudinary variables set is the
    // assertion: importing the module must not throw.
    expect(typeof getR2Env).toBe("function")
    expect(typeof getCloudinaryEnv).toBe("function")
    expect(typeof getScannerEnv).toBe("function")
  })

  it("read process.env when called", () => {
    const before = { ...process.env }

    try {
      Object.assign(process.env, validR2Source, validCloudinarySource)

      expect(getR2Env()).toEqual(validR2Source)
      expect(getCloudinaryEnv()).toEqual(validCloudinarySource)

      for (const key of Object.keys(validR2Source)) {
        delete process.env[key]
      }

      expect(() => getR2Env()).toThrow(/R2_ACCOUNT_ID/)
    } finally {
      process.env = before
    }
  })
})

describe("getScannerEnv", () => {
  it("reads the three scanner variables from process.env", () => {
    const before = { ...process.env }

    try {
      Object.assign(process.env, validScannerSource)

      const parsed = getScannerEnv()

      expect(parsed.SCANNER_URL.toString()).toBe("https://scanner.example.com/")
      expect(parsed.SCANNER_CALLBACK_SECRET).toBe(validScannerSource.SCANNER_CALLBACK_SECRET)

      delete process.env.SCANNER_URL

      expect(() => getScannerEnv()).toThrow(/SCANNER_URL/)
    } finally {
      process.env = before
    }
  })
})

describe("parseOrderAccessSecret", () => {
  it("accepts a secret of at least 32 characters", () => {
    expect(parseOrderAccessSecret({ ORDER_ACCESS_SECRET: "0123456789abcdef0123456789abcdef" })).toBe(
      "0123456789abcdef0123456789abcdef",
    )
  })

  it("refuses a missing or short secret, and names the variable", () => {
    expect(() => parseOrderAccessSecret({})).toThrow(/ORDER_ACCESS_SECRET/)
    expect(() => parseOrderAccessSecret({ ORDER_ACCESS_SECRET: "short" })).toThrow(
      /at least 32 characters/,
    )
    expect(() => parseOrderAccessSecret({ ORDER_ACCESS_SECRET: "   " })).toThrow(
      /ORDER_ACCESS_SECRET/,
    )
  })
})

describe("parseTrackingEnv", () => {
  it("accepts a secret of 32 characters", () => {
    const env = parseTrackingEnv({ CLICK_HASH_SECRET: "a".repeat(32) })

    expect(env.CLICK_HASH_SECRET).toBe("a".repeat(32))
  })

  it("refuses a secret shorter than 32 characters", () => {
    // A short salt is the whole point of the length rule: the hash has to be
    // impossible to reverse by trying every likely IP.
    expect(() => parseTrackingEnv({ CLICK_HASH_SECRET: "a".repeat(31) })).toThrow(/CLICK_HASH_SECRET/)
  })

  it("refuses a missing secret", () => {
    expect(() => parseTrackingEnv({})).toThrow(/CLICK_HASH_SECRET/)
  })

  it("reads process.env when called, and throws when it is absent", () => {
    const before = process.env.CLICK_HASH_SECRET

    try {
      process.env.CLICK_HASH_SECRET = "b".repeat(40)

      expect(getTrackingEnv().CLICK_HASH_SECRET).toBe("b".repeat(40))

      delete process.env.CLICK_HASH_SECRET

      expect(() => getTrackingEnv()).toThrow(/CLICK_HASH_SECRET/)
    } finally {
      if (before === undefined) {
        delete process.env.CLICK_HASH_SECRET
      } else {
        process.env.CLICK_HASH_SECRET = before
      }
    }
  })
})
