import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: () => Promise.resolve({ id: "user-1", email: "ada@example.com" }),
  getUserRoles: () => Promise.resolve(["affiliate"]),
}))

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, getAll: () => [], has: () => false }),
  headers: () => Promise.resolve(new Map()),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))

vi.mock("@/app/auth/actions", () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
  signInWithGoogleAction: vi.fn(),
  requestPasswordResetAction: vi.fn(),
  updatePasswordAction: vi.fn(),
}))

import ForgotPasswordPage from "@/app/forgot-password/page"
import ResetPasswordPage from "@/app/reset-password/page"
import SignInPage from "@/app/sign-in/page"
import SignUpPage from "@/app/sign-up/page"
import { CheckEmailPanel, SignUpForm } from "./sign-up-form"
import { ForgotPasswordForm, ResetLinkSentPanel } from "./forgot-password-form"
import { PasswordUpdatedPanel, ResetPasswordForm } from "./reset-password-form"
import { SignInForm } from "./sign-in-form"
import { SubmitButton } from "./submit-button"
import { TextField } from "./text-field"
import { PasswordField } from "./password-field"

// Every front door page, in every state it can be in.
//
// The assertions are the rules the design system claims rather than a snapshot:
// one h1, labels tied to controls, an error that interrupts and says what to do,
// a loading button that reports itself busy, and a success panel that names the
// address it sent to.

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const page = async (Page: () => React.ReactElement | Promise<React.ReactElement>): Promise<string> =>
  render(await Page())

describe("the auth pages", () => {
  it("sign-in renders one h1, a labelled form and one primary action", async () => {
    const html = await page(() => SignInPage({ searchParams: Promise.resolve({}) }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Sign in")
    expect(html).toContain('for="sign-in-email"')
    expect(html).toContain('for="sign-in-password"')
    expect(html).toContain("Forgot your password?")
    expect(html).toContain("Continue with Google")
    expect(html).toContain("Create an account")
  })

  it("sign-in turns a recognised ?error= into an interrupting alert", async () => {
    const html = await page(() =>
      SignInPage({ searchParams: Promise.resolve({ error: "callback_failed" }) }),
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain("We could not complete sign-in. Please try again.")
  })

  it("sign-in ignores an error value it does not recognise", async () => {
    const html = await page(() =>
      SignInPage({ searchParams: Promise.resolve({ error: "<script>alert(1)</script>" }) }),
    )

    expect(html).not.toContain("<script>")
    expect(html).not.toContain('role="alert"')
  })

  it("sign-up renders one h1, both names, the address and the password guidance", async () => {
    const html = await page(() => SignUpPage())

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain('for="sign-up-first-name"')
    expect(html).toContain('for="sign-up-last-name"')
    expect(html).toContain('for="sign-up-email"')
    expect(html).toContain('for="sign-up-password"')
    expect(html).toContain("At least 10 characters")
  })

  it("forgot-password renders one h1 and a labelled address field", async () => {
    const html = await page(() => ForgotPasswordPage({ searchParams: Promise.resolve({}) }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain('for="forgot-password-email"')
    expect(html).toContain("Send reset link")
  })

  it("reset-password renders one h1 and both password fields", async () => {
    const html = await page(() => ResetPasswordPage())

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain('for="reset-password-new"')
    expect(html).toContain('for="reset-password-confirm"')
    expect(html).toContain("At least 10 characters")
  })

  it("every auth page shows the three verifiable facts, from the site config", async () => {
    for (const html of [
      await page(() => SignInPage({ searchParams: Promise.resolve({}) })),
      await page(() => SignUpPage()),
      await page(() => ForgotPasswordPage({ searchParams: Promise.resolve({}) })),
      await page(() => ResetPasswordPage()),
    ]) {
      expect(html).toContain("Files are security scanned")
      expect(html).toContain("Paystack")
      expect(html).toContain("Payouts go to your bank account")
      expect(html).toContain("Monday to Friday")
    }
  })

  it("reserves the height of the verification widget so the form cannot jump", async () => {
    const html = render(createElement(SignInForm))

    expect(html).toContain("Checking you are human")
    expect(html).toContain("h-[72px]")
  })
})

describe("the field rhythm", () => {
  it("puts the label above the control and ties it to it", () => {
    const html = render(
      createElement(TextField, { id: "email", label: "Email", value: "", onChange: () => undefined }),
    )

    expect(html).toContain('for="email"')
    expect(html).toContain('id="email"')
    expect(html.indexOf("<label")).toBeLessThan(html.indexOf("<input"))
  })

  it("shows a validation message that says how to fix the problem, and marks the field invalid", () => {
    const html = render(
      createElement(TextField, {
        id: "email",
        label: "Email",
        value: "not-an-address",
        onChange: () => undefined,
        error: "Add an @ and the domain, like name@example.com",
      }),
    )

    expect(html).toContain("Add an @ and the domain, like name@example.com")
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="email-error"')
  })

  it("marks the show and hide control as pressed, and names it", () => {
    const html = render(
      createElement(PasswordField, { id: "password", label: "Password", value: "", onChange: () => undefined }),
    )

    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain("Show password")
  })

  it("offers the strength line only where the form asks for it", () => {
    const plain = render(
      createElement(PasswordField, { id: "password", label: "Password", value: "", onChange: () => undefined }),
    )
    const withStrength = render(
      createElement(PasswordField, {
        id: "password",
        label: "Password",
        value: "short",
        onChange: () => undefined,
        showStrength: true,
      }),
    )

    expect(plain).not.toContain("Too short")
    expect(withStrength).toContain("Too short")
    expect(withStrength).toContain('aria-live="polite"')
  })
})

describe("the loading state", () => {
  it("reports itself busy and disables the control while the request is in flight", () => {
    const html = render(createElement(SubmitButton, { pending: true, children: "Sign in" }))

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("disabled")
  })
})

describe("the success states", () => {
  it("sign-up names the address it sent to, and offers a way back", () => {
    const html = render(createElement(CheckEmailPanel, { email: "ada@example.com", onDifferentEmail: () => undefined }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Check your email")
    expect(html).toContain("font-medium")
    expect(html).toContain("ada@example.com")
    expect(html).toContain("spam")
    expect(html).toContain("Use a different email")
  })

  it("the reset link panel says the same neutral sentence whether or not the account exists", () => {
    const html = render(createElement(ResetLinkSentPanel, { email: "ada@example.com" }))

    expect(html).toContain("If an account exists for")
    expect(html).toContain("a reset link to it.")
    expect(html).toContain("ada@example.com")
  })

  it("the updated password panel points at the next thing to do", () => {
    const html = render(createElement(PasswordUpdatedPanel))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Password updated")
    expect(html).toContain('href="/"')
  })
})

describe("the forms are the same forms", () => {
  it("sign-up still links the three agreements", () => {
    const html = render(createElement(SignUpForm))

    expect(html).toContain("By creating an account you agree to the")
    expect(html).toContain('href="/terms-of-service"')
    expect(html).toContain('href="/privacy-policy"')
    expect(html).toContain('href="/cookie-policy"')
  })

  it("forgot-password and reset-password keep their primary action", () => {
    expect(render(createElement(ForgotPasswordForm))).toContain("Send reset link")
    expect(render(createElement(ResetPasswordForm))).toContain("Update password")
  })
})
