// Short links and the places an affiliate shares them.
//
// The short link is the public host's /r/<code>, which is the route the tracking
// click lives on. The share builders are plain URLs with every value encoded:
// a product title is written by a vendor, so it may contain anything, including
// a quote or a "<script>". encodeURIComponent is what stops it from breaking out
// of the query string.

import { appUrl } from "@/lib/identity/app-urls"

/** The absolute short link for a code or alias: https://<public host>/r/<code>. */
export function shortLinkUrl(code: string): string {
  return appUrl("public", `/r/${encodeURIComponent(code)}`)
}

export interface ShareInput {
  url: string
  title: string
}

export interface ShareUrls {
  whatsapp: string
  x: string
  facebook: string
  telegram: string
}

/** The four share links, with the title and URL encoded. */
export function shareUrls({ url, title }: ShareInput): ShareUrls {
  const encodedUrl = encodeURIComponent(url)
  const encodedTitle = encodeURIComponent(title)

  return {
    // WhatsApp takes one text parameter that holds both the words and the link.
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
    x: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`,
  }
}
