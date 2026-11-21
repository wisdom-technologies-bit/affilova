import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/auth/actions", () => ({
  signUpAction: vi.fn(),
}))

import { SignUpForm } from "./sign-up-form"

describe("SignUpForm", () => {
  it("links Terms of Service, Privacy Policy and Cookie Policy in the agreement notice", () => {
    const html = renderToString(createElement(SignUpForm))

    expect(html).toContain("By creating an account you agree to the")
    expect(html).toContain('href="/terms-of-service"')
    expect(html).toContain('href="/privacy-policy"')
    expect(html).toContain('href="/cookie-policy"')
    expect(html).toContain("Terms of Service")
    expect(html).toContain("Privacy Policy")
    expect(html).toContain("Cookie Policy")
  })
})
