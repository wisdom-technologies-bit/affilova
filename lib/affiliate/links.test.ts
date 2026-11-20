import { beforeEach, describe, expect, it, vi } from "vitest"

// Short links and share URLs.
//
// The hostile title is the point: a product title is vendor-written text, so it
// may contain a quote, an ampersand and a closing tag. Every value must come out
// of these builders percent-encoded, or a share link becomes an injection.

const BASE_ENV: Record<string, string> = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_COOKIE_DOMAIN: "",
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
}

beforeEach(() => {
  vi.resetModules()

  for (const [key, value] of Object.entries(BASE_ENV)) {
    process.env[key] = value
  }
})

async function load() {
  return import("./links")
}

describe("shortLinkUrl", () => {
  it("uses the public host and the click route", async () => {
    const { shortLinkUrl } = await load()

    expect(shortLinkUrl("abc123")).toBe("https://affilova.vercel.app/r/abc123")
  })

  it("encodes a code rather than pasting it", async () => {
    const { shortLinkUrl } = await load()

    expect(shortLinkUrl("a b/c?d")).toBe("https://affilova.vercel.app/r/a%20b%2Fc%3Fd")
  })
})

describe("shareUrls", () => {
  const url = "https://affilova.vercel.app/r/abc123"
  const title = `Ada's "best" <script>alert(1)</script> & more`

  it("builds the four destinations", async () => {
    const { shareUrls } = await load()
    const urls = shareUrls({ url, title })

    expect(urls.whatsapp.startsWith("https://wa.me/?text=")).toBe(true)
    expect(urls.x.startsWith("https://twitter.com/intent/tweet?url=")).toBe(true)
    expect(urls.facebook.startsWith("https://www.facebook.com/sharer/sharer.php?u=")).toBe(true)
    expect(urls.telegram.startsWith("https://t.me/share/url?url=")).toBe(true)
  })

  it("encodes the URL everywhere it appears", async () => {
    const { shareUrls } = await load()
    const urls = shareUrls({ url, title })
    const encodedUrl = encodeURIComponent(url)

    expect(urls.x).toContain(`url=${encodedUrl}&`)
    expect(urls.facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)
    expect(urls.telegram).toContain(`url=${encodedUrl}&`)
    expect(urls.whatsapp).toContain(encodedUrl)
  })

  it("encodes a hostile title and leaves no raw markup in any link", async () => {
    const { shareUrls } = await load()
    const urls = shareUrls({ url, title })

    for (const destination of Object.values(urls)) {
      expect(destination).not.toContain("<script>")
      expect(destination).not.toContain('"best"')
    }

    // Facebook takes only the URL, so it carries no title at all.
    expect(urls.facebook).not.toContain(encodeURIComponent(title))
    expect(urls.x).toContain(encodeURIComponent(title))
    expect(urls.telegram).toContain(encodeURIComponent(title))
    expect(urls.whatsapp).toContain(encodeURIComponent(title))
  })

  it("keeps the title out of the Facebook link, which takes only a URL", async () => {
    const { shareUrls } = await load()

    expect(shareUrls({ url, title }).facebook).not.toContain("Ada")
  })

  it("puts the title and the link in the WhatsApp text", async () => {
    const { shareUrls } = await load()

    expect(shareUrls({ url, title }).whatsapp).toBe(
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
    )
  })
})
