import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/identity/mfa-actions", () => ({
  submitEnrollmentCode: vi.fn(),
  submitVerifyCode: vi.fn(),
  beginEnrollment: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))

import EnrollPage from "@/app/two-factor/enroll/page"
import VerifyPage from "@/app/two-factor/verify/page"
import { EnrollForm, VerifyForm } from "./two-factor-forms"

// The two-factor screens: three numbered steps in one card to turn it on, one
// focused card to use it.

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const SECRET = "JBSWY3DPEHPK3PXP"
const QR = "data:image/png;base64,iVBORw0KGgo="

describe("enrolling", () => {
  it("renders one h1 and the three numbered steps in order", () => {
    const html = render(createElement(EnrollForm, { qrCode: QR, secret: SECRET, next: "/admin" }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("<ol")
    expect(html.indexOf("Install an authenticator app")).toBeLessThan(
      html.indexOf("Scan the code or copy the key"),
    )
    expect(html.indexOf("Scan the code or copy the key")).toBeLessThan(
      html.indexOf("Enter the 6 digit code"),
    )
  })

  it("shows the QR code at 192px with text that describes it", () => {
    const html = render(createElement(EnrollForm, { qrCode: QR, secret: SECRET, next: "/admin" }))

    expect(html).toContain('width="192"')
    expect(html).toContain('height="192"')
    expect(html).toContain('alt="QR code to scan with an authenticator app"')
  })

  it("shows the secret in groups of four and copies it without the spaces", () => {
    const html = render(createElement(EnrollForm, { qrCode: QR, secret: SECRET, next: "/admin" }))

    expect(html).toContain("JBSW Y3DP EHPK 3PXP")
    expect(html).toContain("Copy key")
    // The spaces are for reading; the copied value is the secret itself, which
    // is handed to the button rather than rendered into the document.
    expect(html).not.toContain(`value="${SECRET}"`)
  })

  it("takes a six digit code with a numeric keypad and one-time-code autofill", () => {
    const html = render(createElement(EnrollForm, { qrCode: QR, secret: SECRET, next: "/admin" }))

    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain('autoComplete="one-time-code"')
    expect(html).toContain('maxLength="6"')
  })

  it("says a lost device is reset by another admin, in plain words", () => {
    const html = render(createElement(EnrollForm, { qrCode: QR, secret: SECRET, next: "/admin" }))

    expect(html).toContain("If you lose the device, another admin can reset two-factor")
    expect(html).toContain("new device")
  })

  it("renders the page with its own h1 and the same steps", async () => {
    const { beginEnrollment } = await import("@/lib/identity/mfa-actions")
    vi.mocked(beginEnrollment).mockResolvedValue({ ok: true, factorId: "f1", qrCode: QR, secret: SECRET })

    const html = render(await EnrollPage({ searchParams: Promise.resolve({}) }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Scan the code or copy the key")
  })
})

describe("verifying", () => {
  it("renders one h1, one code field and one action", () => {
    const html = render(createElement(VerifyForm, { next: "/admin" }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain('autoComplete="one-time-code"')
    expect(html).toContain("Verify")
  })

  it("renders the page with a single focused card", async () => {
    const html = render(await VerifyPage({ searchParams: Promise.resolve({}) }))

    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).toContain("Enter your code")
  })
})
