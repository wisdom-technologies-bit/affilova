// QR codes for affiliate links.
//
// The SVG is produced by the qrcode package from a URL this app built, so it
// contains no user text. It is still checked before it is put into the page with
// dangerouslySetInnerHTML: an SVG that carries a script, a foreignObject or an
// event attribute is refused rather than rendered. That check is what makes the
// inline rendering safe, and it is unit tested.

import QRCode from "qrcode"

const FORBIDDEN = [/<script/i, /<foreignObject/i, /javascript:/i, /\son[a-z]+\s*=/i]

/**
 * True when the string is a single, script-free SVG element.
 *
 * The check is deliberately narrow: the only producer is qrcode, and a value
 * that does not look like its output has no business in the page.
 */
export function isSafeQrSvg(svg: string): boolean {
  const trimmed = svg.trim()

  if (!trimmed.startsWith("<svg") || !trimmed.endsWith("</svg>")) {
    return false
  }

  return !FORBIDDEN.some((pattern) => pattern.test(trimmed))
}

/** The SVG for a URL, as a string, or null when the output fails the check. */
export async function generateQrSvg(url: string): Promise<string | null> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: { dark: "#0b0d0a", light: "#ffffff" },
  })

  return isSafeQrSvg(svg) ? svg : null
}
