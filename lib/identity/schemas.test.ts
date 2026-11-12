import { describe, expect, it } from "vitest"

import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "./schemas"

const PASSWORD_10 = "a".repeat(10)
const PASSWORD_128 = "a".repeat(128)
const PASSWORD_129 = "a".repeat(129)
const PASSWORD_9 = "a".repeat(9)

const validSignUp = {
  email: "person@example.com",
  password: PASSWORD_10,
  firstName: "Ada",
  lastName: "Lovelace",
}

describe("signUpSchema", () => {
  it("accepts a valid signup", () => {
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true)
  })

  it("trims and lowercases the email", () => {
    const parsed = signUpSchema.parse({ ...validSignUp, email: "  Person@Example.COM " })

    expect(parsed.email).toBe("person@example.com")
  })

  it("trims the names", () => {
    const parsed = signUpSchema.parse({
      ...validSignUp,
      firstName: "  Ada  ",
      lastName: " Lovelace ",
    })

    expect(parsed.firstName).toBe("Ada")
    expect(parsed.lastName).toBe("Lovelace")
  })

  it("rejects an invalid email", () => {
    for (const email of ["", "  ", "person", "person@", "@example.com", "person@example"]) {
      expect(signUpSchema.safeParse({ ...validSignUp, email }).success).toBe(false)
    }
  })

  it("enforces the 10 to 128 character password range", () => {
    expect(signUpSchema.safeParse({ ...validSignUp, password: PASSWORD_9 }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...validSignUp, password: PASSWORD_10 }).success).toBe(true)
    expect(signUpSchema.safeParse({ ...validSignUp, password: PASSWORD_128 }).success).toBe(true)
    expect(signUpSchema.safeParse({ ...validSignUp, password: PASSWORD_129 }).success).toBe(false)
  })

  it("applies no other password rules", () => {
    // No symbol, no digit, no uppercase: length is the only rule.
    expect(signUpSchema.safeParse({ ...validSignUp, password: "aaaaaaaaaa" }).success).toBe(true)
  })

  it("enforces the 1 to 100 character name range", () => {
    const limits = [
      { firstName: "", lastName: "Lovelace" },
      { firstName: " ", lastName: "Lovelace" },
      { firstName: "a".repeat(100), lastName: "a".repeat(100) },
      { firstName: "a".repeat(101), lastName: "Lovelace" },
      { firstName: "Ada", lastName: "".padEnd(101, "b") },
    ]

    expect(signUpSchema.safeParse({ ...validSignUp, ...limits[0] }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...validSignUp, ...limits[1] }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...validSignUp, ...limits[2] }).success).toBe(true)
    expect(signUpSchema.safeParse({ ...validSignUp, ...limits[3] }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...validSignUp, ...limits[4] }).success).toBe(false)
  })

  it("accepts a missing or present captcha token", () => {
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true)
    expect(
      signUpSchema.safeParse({ ...validSignUp, captchaToken: "turnstile-token" }).success,
    ).toBe(true)
    expect(signUpSchema.safeParse({ ...validSignUp, captchaToken: 42 }).success).toBe(false)
  })
})

describe("signInSchema", () => {
  const valid = { email: "person@example.com", password: "anything" }

  it("accepts a short password and an empty-looking one is rejected", () => {
    expect(signInSchema.safeParse(valid).success).toBe(true)
    expect(signInSchema.safeParse({ ...valid, password: "" }).success).toBe(false)
  })

  it("enforces the 1 to 128 character password range", () => {
    expect(signInSchema.safeParse({ ...valid, password: "a" }).success).toBe(true)
    expect(signInSchema.safeParse({ ...valid, password: PASSWORD_128 }).success).toBe(true)
    expect(signInSchema.safeParse({ ...valid, password: PASSWORD_129 }).success).toBe(false)
  })

  it("normalises the email", () => {
    const parsed = signInSchema.parse({ ...valid, email: " PERSON@Example.com " })

    expect(parsed.email).toBe("person@example.com")
  })

  it("rejects an invalid email", () => {
    expect(signInSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false)
  })

  it("accepts an optional captcha token", () => {
    expect(signInSchema.safeParse(valid).success).toBe(true)
    expect(signInSchema.safeParse({ ...valid, captchaToken: "token" }).success).toBe(true)
  })
})

describe("forgotPasswordSchema", () => {
  it("accepts a valid email with or without a captcha token", () => {
    expect(forgotPasswordSchema.safeParse({ email: "person@example.com" }).success).toBe(true)
    expect(
      forgotPasswordSchema.safeParse({ email: "person@example.com", captchaToken: "token" }).success,
    ).toBe(true)
  })

  it("rejects an invalid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "person@" }).success).toBe(false)
  })
})

describe("updatePasswordSchema", () => {
  it("enforces the 10 to 128 character password range", () => {
    expect(updatePasswordSchema.safeParse({ password: PASSWORD_9 }).success).toBe(false)
    expect(updatePasswordSchema.safeParse({ password: PASSWORD_10 }).success).toBe(true)
    expect(updatePasswordSchema.safeParse({ password: PASSWORD_128 }).success).toBe(true)
    expect(updatePasswordSchema.safeParse({ password: PASSWORD_129 }).success).toBe(false)
  })

  it("has no other requirements", () => {
    expect(updatePasswordSchema.safeParse({ password: "aaaaaaaaaa" }).success).toBe(true)
  })
})
