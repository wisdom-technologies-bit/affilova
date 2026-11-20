import { describe, expect, it } from "vitest"

import { generateQrSvg, isSafeQrSvg } from "./qr"

// The QR guard.
//
// The SVG is rendered into the page with dangerouslySetInnerHTML, so the check
// that it is a single script-free element is the thing that makes that safe. It
// is tested against the library's real output and against doctored strings.

describe("isSafeQrSvg", () => {
  it("accepts what the library produces", async () => {
    const svg = await generateQrSvg("https://affilova.vercel.app/r/abc123")

    expect(svg).not.toBeNull()
    expect(isSafeQrSvg(svg ?? "")).toBe(true)
  })

  it("refuses a script", () => {
    expect(isSafeQrSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toBe(
      false,
    )
  })

  it("refuses a foreignObject", () => {
    expect(
      isSafeQrSvg('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>'),
    ).toBe(false)
  })

  it("refuses an event attribute", () => {
    expect(isSafeQrSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')).toBe(
      false,
    )
  })

  it("refuses a javascript: URL", () => {
    expect(isSafeQrSvg('<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)" /></svg>')).toBe(
      false,
    )
  })

  it("refuses something that is not an svg element", () => {
    expect(isSafeQrSvg("<div>hello</div>")).toBe(false)
    expect(isSafeQrSvg("")).toBe(false)
    expect(isSafeQrSvg('<svg xmlns="http://www.w3.org/2000/svg">')).toBe(false)
  })
})

describe("generateQrSvg", () => {
  it("draws a square svg with no script and no foreignObject", async () => {
    const svg = await generateQrSvg("https://affilova.vercel.app/r/abc123")

    expect(svg).not.toBeNull()
    expect(svg).toContain("<svg")
    expect(svg).not.toContain("<script")
    expect(svg).not.toContain("foreignObject")
    expect(svg).toContain("</svg>")
  })

  it("draws a long link too", async () => {
    const svg = await generateQrSvg(`https://affilova.vercel.app/r/${"a".repeat(60)}`)

    expect(svg === null ? false : isSafeQrSvg(svg)).toBe(true)
  })
})
