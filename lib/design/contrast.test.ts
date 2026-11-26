import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  contrastRatio,
  formatRatio,
  hexToRgb,
  hslToHex,
  meetsContrast,
  rgbToHsl,
  relativeLuminance,
  textLevel,
  type Hsl,
} from "./contrast"
import {
  BACKGROUND,
  BRAND_500,
  BRAND_600,
  CHART_PALETTE,
  COLOUR_TOKENS,
  CONTRAST_PAIRS,
  TOKENS,
  TYPE_SCALE,
} from "./tokens"

// The palette, measured.
//
// Two jobs:
//   1. the tokens in app/globals.css are the tokens in lib/design/tokens.ts, so a
//      swatch in the style guide is the colour a button actually renders;
//   2. every pair the system draws reaches 4.5:1 for text and 3:1 for a boundary
//      or a focus ring.
//
// When someone changes a token into a failing pair, the second job fails here
// before it reaches a page.

const GLOBALS_CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8")

/** The body of a rule such as `:root { ... }`, without nested rules. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)

  if (start === -1) {
    throw new Error(`app/globals.css has no ${selector} block`)
  }

  let depth = 0
  let index = css.indexOf("{", start)

  for (let cursor = index; cursor < css.length; cursor += 1) {
    const character = css[cursor]

    if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1

      if (depth === 0) {
        index = cursor
        break
      }
    }
  }

  return css.slice(start, index)
}

/** `--name: value;` pairs in one rule, in the order they are written. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>()
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi

  for (const match of block.matchAll(pattern)) {
    found.set(match[1], match[2].trim())
  }

  return found
}

/** A declaration to the HSL triplet it resolves to, following var() aliases. */
function resolveHsl(vars: Map<string, string>, name: string, seen: string[] = []): Hsl {
  const raw = vars.get(name)

  if (raw === undefined) {
    throw new Error(`app/globals.css does not define ${name}`)
  }

  if (seen.includes(name)) {
    throw new Error(`${name} resolves in a circle: ${[...seen, name].join(" -> ")}`)
  }

  const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(raw)

  if (alias !== null) {
    return resolveHsl(vars, alias[1], [...seen, name])
  }

  const parts = raw.split(/\s+/)

  if (parts.length !== 3) {
    throw new Error(`${name} is not a space-separated HSL triplet: ${raw}`)
  }

  const [h, s, l] = parts.map((part) => Number.parseFloat(part))

  if ([h, s, l].some((value) => Number.isNaN(value))) {
    throw new Error(`${name} has a part that is not a number: ${raw}`)
  }

  return { h, s, l }
}

const ROOT = declarations(ruleBody(GLOBALS_CSS, ":root"))
const DARK = declarations(ruleBody(GLOBALS_CSS, ".dark"))

function cssColour(name: string): string {
  return hslToHex(resolveHsl(ROOT, name))
}

describe("the WCAG helpers", () => {
  it("measures the ends of the scale", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5)
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5)
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5)
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5)
  })

  it("does not care which colour comes first", () => {
    expect(contrastRatio("#0E0F0D", "#FFFFFF")).toBeCloseTo(contrastRatio("#FFFFFF", "#0E0F0D"), 10)
  })

  it("reads short hex and long hex the same way", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb("#14A953")).toEqual({ r: 20, g: 169, b: 83 })
    expect(() => hexToRgb("green")).toThrow(/Not a hex colour/)
  })

  it("round-trips a colour through HSL", () => {
    for (const token of COLOUR_TOKENS) {
      const rgb = hexToRgb(token.hex)
      const hsl = rgbToHsl(rgb)

      expect(hslToHex(hsl)).toBe(token.hex.toUpperCase())
    }
  })

  it("writes a ratio the way a person reads it", () => {
    expect(formatRatio(contrastRatio("#107F3E", "#FFFFFF"))).toBe("5.09:1")
    expect(textLevel(21)).toBe("AAA")
    expect(textLevel(5)).toBe("AA")
    expect(textLevel(2)).toBe("Fail")
  })
})

describe("the tokens in globals.css", () => {
  it("are the tokens in lib/design/tokens.ts", () => {
    const mismatched = COLOUR_TOKENS.filter((token) => cssColour(token.cssVar) !== token.hex).map(
      (token) => `${token.cssVar}: css ${cssColour(token.cssVar)} vs tokens ${token.hex}`,
    )

    expect(mismatched).toEqual([])
  })

  it("include the five chart series", () => {
    const mismatched = CHART_PALETTE.filter(
      (series) => cssColour(series.cssVar) !== series.hex,
    ).map((series) => `${series.cssVar}: css ${cssColour(series.cssVar)} vs tokens ${series.hex}`)

    expect(mismatched).toEqual([])
  })

  it("map the shadcn variables onto the system", () => {
    // Not a copy of the value: the alias has to point at the token, so a change
    // to the token reaches every components/ui primitive.
    expect(ROOT.get("--primary")).toBe("var(--brand-600)")
    expect(ROOT.get("--primary-foreground")).toBe("var(--background)")
    expect(ROOT.get("--ring")).toBe("var(--brand-500)")
    expect(ROOT.get("--input")).toBe("var(--border-control)")
    expect(ROOT.get("--destructive")).toBe("var(--danger)")
    expect(ROOT.get("--muted-foreground")).toBe("var(--text-muted)")
    expect(ROOT.get("--card")).toBe("var(--background)")

    expect(cssColour("--primary")).toBe(BRAND_600.hex)
    expect(cssColour("--ring")).toBe(BRAND_500.hex)
  })

  it("keep the dark theme defined but not switched on", () => {
    // A .dark block exists, so a theme switch is a class away ...
    expect(DARK.size).toBeGreaterThan(20)
    expect(DARK.get("--background")).not.toBe(ROOT.get("--background"))

    // ... and nothing turns it on. No component, layout or script sets the class
    // and there is no theme provider, so every surface renders light.
    const root = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8")

    expect(root).not.toMatch(/className=["'`][^"'`]*\bdark\b/)
    expect(root).not.toContain("ThemeProvider")
  })
})

describe("every text pair in the system", () => {
  it.each(CONTRAST_PAIRS.filter((pair) => pair.minimum === 4.5).map((pair) => [pair.name, pair]))(
    "%s reaches 4.5:1",
    (_name, pair) => {
      const ratio = contrastRatio(pair.foreground.hex, pair.background.hex)

      expect(ratio, `${pair.foreground.hex} on ${pair.background.hex} = ${formatRatio(ratio)}`).toBeGreaterThanOrEqual(
        pair.minimum,
      )
    },
  )

  it("measures the pair the browser will actually paint, not just the palette", () => {
    // The same assertion, but from the CSS values, so a token edited in
    // globals.css and forgotten in tokens.ts cannot slip through.
    const failures = CONTRAST_PAIRS.filter(
      (pair) =>
        !meetsContrast(cssColour(pair.foreground.cssVar), cssColour(pair.background.cssVar), pair.minimum),
    ).map((pair) => pair.name)

    expect(failures).toEqual([])
  })
})

describe("every boundary and focus ring", () => {
  it.each(CONTRAST_PAIRS.filter((pair) => pair.minimum === 3).map((pair) => [pair.name, pair]))(
    "%s reaches 3:1",
    (_name, pair) => {
      expect(contrastRatio(pair.foreground.hex, pair.background.hex)).toBeGreaterThanOrEqual(3)
    },
  )

  it("keeps a control edge visible on every surface it can sit on", () => {
    // A field can be on the page, on a subtle band or on a muted row. The edge
    // is drawn on all three, so it is measured on all three.
    for (const surface of [TOKENS.background, TOKENS.surfaceSubtle, TOKENS.surfaceMuted]) {
      const ratio = contrastRatio(TOKENS.borderControl.hex, surface.hex)

      expect(ratio, `${TOKENS.borderControl.hex} on ${surface.hex}`).toBeGreaterThanOrEqual(3)
    }
  })

  it("draws the focus ring outside a 2px page-coloured offset, so it is measured on white", () => {
    // focus-visible:ring-2 + ring-offset-2 in the background colour is what
    // every control uses (the .focus-ring class), which is why the ring only has
    // to clear 3:1 against white and never against a tinted panel.
    expect(CONTRAST_PAIRS.some((pair) => pair.name === "Focus ring")).toBe(true)
    expect(contrastRatio(BRAND_500.hex, BACKGROUND.hex)).toBeGreaterThanOrEqual(3)
  })
})

describe("the chart palette", () => {
  it("keeps every series readable as a label on white", () => {
    for (const series of CHART_PALETTE) {
      const ratio = contrastRatio(series.hex, BACKGROUND.hex)

      expect(ratio, `${series.name} ${series.hex} = ${formatRatio(ratio)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("gives each series a shape and a dash pattern as well as a hue", () => {
    const markers = new Set(CHART_PALETTE.map((series) => series.marker))
    const dashes = new Set(CHART_PALETTE.map((series) => series.dash))

    expect(markers.size).toBe(CHART_PALETTE.length)
    expect(dashes.size).toBe(CHART_PALETTE.length)
  })
})

describe("the type scale", () => {
  it("has one entry per size and no size used twice", () => {
    const sizes = TYPE_SCALE.map((entry) => entry.size)

    expect(new Set(sizes).size).toBe(sizes.length)
    expect(TYPE_SCALE.map((entry) => entry.className)).toContain("text-h1")
  })

  it("keeps a line height that is at least 1.2 times the size", () => {
    for (const entry of TYPE_SCALE) {
      expect(entry.lineHeight / entry.size, entry.className).toBeGreaterThanOrEqual(1.08)
    }
  })
})
