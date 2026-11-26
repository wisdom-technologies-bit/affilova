// WCAG contrast, as arithmetic.
//
// Pure functions with no imports: given two colours, how readable is one on the
// other? The design system's own pairs are asserted against these in
// lib/design/contrast.test.ts, and the style guide prints the same numbers next
// to each swatch, so the figure a person reads on the page is the figure the
// test enforces.
//
// The formulas are the ones in WCAG 2.2: relative luminance from linearised
// sRGB, then (lighter + 0.05) / (darker + 0.05).

/** A colour as three 0-255 channels. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** A colour as hue (0-360), saturation and lightness (both 0-100). */
export interface Hsl {
  h: number
  s: number
  l: number
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function channel(value: string, index: number): number {
  return Number.parseInt(value.slice(index, index + 2), 16)
}

/** "#14A953" or "#4a9" to channels. Throws on anything else. */
export function hexToRgb(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim())

  if (match === null) {
    throw new Error(`Not a hex colour: ${hex}`)
  }

  const digits = match[1]

  if (digits.length === 3) {
    return {
      r: channel(`${digits[0]}${digits[0]}`, 0),
      g: channel(`${digits[1]}${digits[1]}`, 0),
      b: channel(`${digits[2]}${digits[2]}`, 0),
    }
  }

  return { r: channel(digits, 0), g: channel(digits, 2), b: channel(digits, 4) }
}

function toHexPair(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)))

  return clamped.toString(16).padStart(2, "0").toUpperCase()
}

/** Channels to "#RRGGBB". */
export function rgbToHex(rgb: Rgb): string {
  return `#${toHexPair(rgb.r)}${toHexPair(rgb.g)}${toHexPair(rgb.b)}`
}

/** An HSL triplet, as a CSS custom property would hold it, to channels. */
export function hslToRgb(hsl: Hsl): Rgb {
  const s = hsl.s / 100
  const l = hsl.l / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hue = ((hsl.h % 360) + 360) % 360
  const sector = hue / 60
  const x = c * (1 - Math.abs((sector % 2) - 1))
  const m = l - c / 2

  let base: [number, number, number]

  if (sector < 1) {
    base = [c, x, 0]
  } else if (sector < 2) {
    base = [x, c, 0]
  } else if (sector < 3) {
    base = [0, c, x]
  } else if (sector < 4) {
    base = [0, x, c]
  } else if (sector < 5) {
    base = [x, 0, c]
  } else {
    base = [c, 0, x]
  }

  return {
    r: Math.round((base[0] + m) * 255),
    g: Math.round((base[1] + m) * 255),
    b: Math.round((base[2] + m) * 255),
  }
}

/** An HSL triplet to "#RRGGBB", the way the browser resolves it. */
export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl))
}

/** Channels to an HSL triplet, for reading a colour back out of the CSS. */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min

  if (delta === 0) {
    return { h: 0, s: 0, l: l * 100 }
  }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

  let h: number

  if (max === r) {
    h = (g - b) / delta + (g < b ? 6 : 0)
  } else if (max === g) {
    h = (b - r) / delta + 2
  } else {
    h = (r - g) / delta + 4
  }

  return { h: h * 60, s: s * 100, l: l * 100 }
}

function linearise(value: number): number {
  const channelValue = value / 255

  return channelValue <= 0.03928
    ? channelValue / 12.92
    : Math.pow((channelValue + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)

  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

/** The contrast ratio of two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)

  return (lighter + 0.05) / (darker + 0.05)
}

/** True when the pair reaches the minimum for its kind (4.5 text, 3 boundary). */
export function meetsContrast(foreground: string, background: string, minimum: number): boolean {
  // A hair of tolerance so a value computed at exactly 4.5 is not failed by
  // floating point noise.
  return contrastRatio(foreground, background) + 1e-9 >= minimum
}

/** "5.09:1", the way a contrast ratio is written. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`
}

/** The WCAG level a text ratio reaches: AAA at 7, AA at 4.5, otherwise fail. */
export function textLevel(ratio: number): "AAA" | "AA" | "Fail" {
  if (ratio >= 7) {
    return "AAA"
  }

  if (ratio >= 4.5) {
    return "AA"
  }

  return "Fail"
}
