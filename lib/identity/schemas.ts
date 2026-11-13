import { z } from "zod"

// Input schemas for the auth server actions. They are the only place the shape
// of an auth form is defined: the actions parse with these and never trust a
// field directly.
//
// The password rules are deliberately shallow: length only. Strength beyond
// that is enforced by the breached-password check in lib/identity/password.ts
// and by Supabase's own minimum length setting.

const email = z
  .string({ required_error: "Enter your email address" })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254, "That email address is too long")
  .email("Enter a valid email address")

const captchaToken = z.string().optional()

const newPassword = z
  .string({ required_error: "Enter a password" })
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")

const name = z
  .string({ required_error: "Enter your name" })
  .trim()
  .min(1, "Enter your name")
  .max(100, "Use at most 100 characters")

export const signUpSchema = z.object({
  email,
  password: newPassword,
  firstName: name,
  lastName: name,
  captchaToken,
})

export const signInSchema = z.object({
  email,
  password: z
    .string({ required_error: "Enter your password" })
    .min(1, "Enter your password")
    .max(128, "Use at most 128 characters"),
  captchaToken,
})

export const forgotPasswordSchema = z.object({
  email,
  captchaToken,
})

export const updatePasswordSchema = z.object({
  password: newPassword,
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>
