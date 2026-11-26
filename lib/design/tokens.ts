// The design tokens, as data.
//
// app/globals.css is what the browser reads; this file is the same palette in
// hex so it can be measured (lib/design/contrast.test.ts) and drawn (the style
// guide). The two are held together by a test that parses globals.css, converts
// each HSL triplet back to a colour and compares it with the value here, so a
// token cannot be changed in one place and quietly drift in the other.
//
// Nothing here imports React or touches the DOM: it is data.

/** One colour token: where it lives in CSS, what it is, and its hex value. */
export interface ColourToken {
  /** Human name, used in the style guide and the docs. */
  name: string
  /** The custom property in app/globals.css, e.g. "--surface-subtle". */
  cssVar: string
  /** The value in #RRGGBB, upper case. */
  hex: string
  /** What it is for. One sentence, sentence case. */
  role: string
}

/** A text-on-background or boundary-on-background pair the system relies on. */
export interface ContrastPair {
  /** What is being measured, e.g. "Body text on the page". */
  name: string
  /** The token used for the text, the boundary or the ring. */
  foreground: ColourToken
  /** The token it sits on. */
  background: ColourToken
  /** 4.5 for text, 3 for a boundary or a focus ring. */
  minimum: 4.5 | 3
}

function token(cssVar: string, name: string, hex: string, role: string): ColourToken {
  return { name, cssVar, hex, role }
}

// Neutrals, derived from the ink. The ink is the text colour, not a background:
// nothing in the system paints a page in it.
export const INK = token("--foreground", "Text", "#0E0F0D", "Body and heading text on white.")
export const BACKGROUND = token("--background", "Background", "#FFFFFF", "The page. Every panel sits on it.")
export const SURFACE_SUBTLE = token(
  "--surface-subtle",
  "Surface subtle",
  "#F7F8F7",
  "A quiet section behind content: a page band, a table header, a code block.",
)
export const SURFACE_MUTED = token(
  "--surface-muted",
  "Surface muted",
  "#EFF1EF",
  "A pressed or selected row, a secondary control, a skeleton block.",
)
export const BORDER = token(
  "--border",
  "Border",
  "#E3E6E3",
  "The 1px rule between things: card edges, table rows, dividers.",
)
export const BORDER_STRONG = token(
  "--border-strong",
  "Border strong",
  "#CDD2CD",
  "A rule that has to be seen: a header underline, a hover edge.",
)
export const BORDER_CONTROL = token(
  "--border-control",
  "Border control",
  "#848B84",
  "The edge of a control that must reach 3:1 against white (WCAG 1.4.11): inputs, selects, checkboxes, switches and secondary buttons.",
)
export const TEXT_MUTED = token(
  "--text-muted",
  "Text muted",
  "#4B524B",
  "The second line: a description, a column header, a helper sentence.",
)
export const TEXT_SUBTLE = token(
  "--text-subtle",
  "Text subtle",
  "#6B736B",
  "The third line and placeholders. Still 4.9:1 on white, so it is read, not squinted at.",
)

// The brand scale. Green is an accent: primary actions, active states, the
// logo. It is never a background wash and never a gradient.
export const BRAND_50 = token("--brand-50", "Brand 50", "#EAF9F0", "The selected row and the quiet badge background.")
export const BRAND_100 = token("--brand-100", "Brand 100", "#D6F2E2", "The avatar disc and the hover on a selected row.")
export const BRAND_500 = token(
  "--brand-500",
  "Brand 500",
  "#14A953",
  "Graphics only: the focus ring, a chart series, a progress bar. 3.07:1 on white, so never text.",
)
export const BRAND_600 = token(
  "--brand-600",
  "Brand 600",
  "#107F3E",
  "Text on white and the primary button. 5.09:1, which is why the action green is one step darker than the logo green.",
)
export const BRAND_700 = token("--brand-700", "Brand 700", "#0D6B34", "The primary button on hover, and a link on white.")

// Semantic pairs. Each is a text colour on its own pale background, measured at
// 4.5:1 or better, and always paired with an icon and a word.
export const SUCCESS = token("--success", "Success", "#0F6B35", "A completed payout, a saved setting.")
export const SUCCESS_SUBTLE = token("--success-subtle", "Success subtle", "#E8F6EE", "The background behind success text.")
export const WARNING = token("--warning", "Warning", "#7A4B00", "Something that needs a decision: a payout on hold.")
export const WARNING_SUBTLE = token("--warning-subtle", "Warning subtle", "#FFF4DB", "The background behind warning text.")
export const DANGER = token("--danger", "Danger", "#B42318", "A failed transfer, a destructive action, a validation error.")
export const DANGER_SUBTLE = token("--danger-subtle", "Danger subtle", "#FDECEA", "The background behind danger text.")
export const INFO = token("--info", "Info", "#1D4E89", "A neutral explanation: how a number is worked out.")
export const INFO_SUBTLE = token("--info-subtle", "Info subtle", "#E8F0FA", "The background behind info text.")

/** Every colour token, in the order the style guide shows them. */
export const COLOUR_TOKENS: readonly ColourToken[] = [
  BACKGROUND,
  SURFACE_SUBTLE,
  SURFACE_MUTED,
  INK,
  TEXT_MUTED,
  TEXT_SUBTLE,
  BORDER,
  BORDER_STRONG,
  BORDER_CONTROL,
  BRAND_50,
  BRAND_100,
  BRAND_500,
  BRAND_600,
  BRAND_700,
  SUCCESS,
  SUCCESS_SUBTLE,
  WARNING,
  WARNING_SUBTLE,
  DANGER,
  DANGER_SUBTLE,
  INFO,
  INFO_SUBTLE,
]

/**
 * Every pair the system uses, and the ratio it has to keep.
 *
 * Text is measured at 4.5:1 (WCAG 1.4.3); a boundary or a focus ring at 3:1
 * (1.4.11). The focus ring is drawn outside a 2px offset in the page colour, so
 * it is always measured against white, whichever surface the control sits on.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { name: "Body text on the page", foreground: INK, background: BACKGROUND, minimum: 4.5 },
  { name: "Body text on a subtle surface", foreground: INK, background: SURFACE_SUBTLE, minimum: 4.5 },
  { name: "Body text on a muted surface", foreground: INK, background: SURFACE_MUTED, minimum: 4.5 },
  { name: "Muted text on the page", foreground: TEXT_MUTED, background: BACKGROUND, minimum: 4.5 },
  { name: "Muted text on a subtle surface", foreground: TEXT_MUTED, background: SURFACE_SUBTLE, minimum: 4.5 },
  { name: "Muted text on a muted surface", foreground: TEXT_MUTED, background: SURFACE_MUTED, minimum: 4.5 },
  { name: "Subtle text on the page", foreground: TEXT_SUBTLE, background: BACKGROUND, minimum: 4.5 },
  { name: "Subtle text on a subtle surface", foreground: TEXT_SUBTLE, background: SURFACE_SUBTLE, minimum: 4.5 },
  { name: "Placeholder text", foreground: TEXT_SUBTLE, background: BACKGROUND, minimum: 4.5 },
  { name: "Primary button label", foreground: BACKGROUND, background: BRAND_600, minimum: 4.5 },
  { name: "Primary button label on hover", foreground: BACKGROUND, background: BRAND_700, minimum: 4.5 },
  { name: "Link text on the page", foreground: BRAND_600, background: BACKGROUND, minimum: 4.5 },
  { name: "Success text", foreground: SUCCESS, background: SUCCESS_SUBTLE, minimum: 4.5 },
  { name: "Warning text", foreground: WARNING, background: WARNING_SUBTLE, minimum: 4.5 },
  { name: "Danger text", foreground: DANGER, background: DANGER_SUBTLE, minimum: 4.5 },
  { name: "Info text", foreground: INFO, background: INFO_SUBTLE, minimum: 4.5 },
  { name: "Control boundary", foreground: BORDER_CONTROL, background: BACKGROUND, minimum: 3 },
  { name: "Focus ring", foreground: BRAND_500, background: BACKGROUND, minimum: 3 },
]

/** The type scale. Sizes in px, line heights in px, tracking in em. */
export interface TypeToken {
  /** The Tailwind class, e.g. "text-h1". */
  className: string
  name: string
  size: number
  lineHeight: number
  weight: 400 | 500 | 600
  tracking: number
  /** Where it is allowed. */
  use: string
}

export const TYPE_SCALE: readonly TypeToken[] = [
  {
    className: "text-display",
    name: "Display",
    size: 48,
    lineHeight: 52,
    weight: 600,
    tracking: -0.03,
    use: "Public pages only: the one line above the fold.",
  },
  {
    className: "text-display-sm",
    name: "Display small",
    size: 36,
    lineHeight: 40,
    weight: 600,
    tracking: -0.02,
    use: "Public pages only: a section opener.",
  },
  {
    className: "text-h1",
    name: "Heading 1",
    size: 30,
    lineHeight: 36,
    weight: 600,
    tracking: -0.02,
    use: "One per page. The page title, in PageHeader.",
  },
  {
    className: "text-h2",
    name: "Heading 2",
    size: 22,
    lineHeight: 28,
    weight: 600,
    tracking: -0.01,
    use: "A section title, in Section.",
  },
  {
    className: "text-h3",
    name: "Heading 3",
    size: 18,
    lineHeight: 24,
    weight: 500,
    tracking: 0,
    use: "A panel or a card title inside a section.",
  },
  {
    className: "text-body",
    name: "Body",
    size: 15,
    lineHeight: 24,
    weight: 400,
    tracking: 0,
    use: "Everything a person reads: paragraphs, field values, table cells.",
  },
  {
    className: "text-dense",
    name: "Dense body",
    size: 14,
    lineHeight: 20,
    weight: 400,
    tracking: 0,
    use: "Dashboards where the row height matters: table cells, KPI hints.",
  },
  {
    className: "text-small",
    name: "Small",
    size: 13,
    lineHeight: 18,
    weight: 400,
    tracking: 0,
    use: "A helper line under a field, a secondary action, a badge.",
  },
  {
    className: "text-caption",
    name: "Caption",
    size: 12,
    lineHeight: 16,
    weight: 400,
    tracking: 0,
    use: "The smallest text allowed: a timestamp, a column unit, a footnote.",
  },
]

/** The spacing scale, on a 4px base. */
export const SPACING_SCALE: readonly { token: string; px: number; use: string }[] = [
  { token: "xs", px: 4, use: "Inside a badge, between an icon and its word." },
  { token: "sm", px: 8, use: "Between a label and its field." },
  { token: "md", px: 12, use: "Between rows, inside a compact control." },
  { token: "lg", px: 16, use: "The default padding inside a panel." },
  { token: "xl", px: 24, use: "Between sections." },
  { token: "2xl", px: 32, use: "A page's top padding, a large gap." },
  { token: "3xl", px: 48, use: "Between major blocks on a public page." },
  { token: "4xl", px: 64, use: "Above and below a public hero." },
]

/** Radii. Nothing in the system is fully round except an avatar and a pill. */
export const RADII: readonly { token: string; px: number; use: string }[] = [
  { token: "sm", px: 6, use: "A badge, a small chip, a checkbox." },
  { token: "md", px: 8, use: "The default: buttons, inputs, cards." },
  { token: "lg", px: 12, use: "A dialog, a sheet, a large panel." },
  { token: "xl", px: 16, use: "A public page card. Never inside the product." },
]

/** The one motion token, and the override that removes it. */
export const MOTION = {
  duration: "150ms",
  easing: "cubic-bezier(0, 0, 0.2, 1)",
  reducedMotion:
    "@media (prefers-reduced-motion: reduce) — transitions and animations are removed, not shortened.",
} as const

/** The container widths, by kind of page. */
export const CONTAINERS: readonly { token: string; width: string; use: string }[] = [
  { token: "dashboard", width: "1152px", use: "Every signed-in app." },
  { token: "public", width: "1200px", use: "The marketplace and the marketing pages." },
  { token: "reading", width: "70ch", use: "A legal document or a long explanation." },
]

/**
 * The chart palette.
 *
 * Five hues, each 4.5:1 or better on white so the same colour can label a series
 * in text. Hue alone is never the only signal: every series also carries a
 * direct label, and a line gets its own dash pattern and marker shape. See
 * docs/design-system.md.
 */
export const CHART_PALETTE: readonly {
  name: string
  cssVar: string
  hex: string
  marker: string
  dash: string
}[] = [
  { name: "Series 1", cssVar: "--chart-1", hex: "#0F6B35", marker: "circle", dash: "none" },
  { name: "Series 2", cssVar: "--chart-2", hex: "#1D4E89", marker: "square", dash: "6 3" },
  { name: "Series 3", cssVar: "--chart-3", hex: "#7A4B00", marker: "triangle", dash: "2 3" },
  { name: "Series 4", cssVar: "--chart-4", hex: "#6B3FA0", marker: "diamond", dash: "10 4 2 4" },
  { name: "Series 5", cssVar: "--chart-5", hex: "#B42318", marker: "cross", dash: "1 4" },
]

/** The token set as one object, for code that needs a colour by name. */
export const TOKENS = {
  background: BACKGROUND,
  ink: INK,
  surfaceSubtle: SURFACE_SUBTLE,
  surfaceMuted: SURFACE_MUTED,
  border: BORDER,
  borderStrong: BORDER_STRONG,
  borderControl: BORDER_CONTROL,
  textMuted: TEXT_MUTED,
  textSubtle: TEXT_SUBTLE,
  brand50: BRAND_50,
  brand100: BRAND_100,
  brand500: BRAND_500,
  brand600: BRAND_600,
  brand700: BRAND_700,
  success: SUCCESS,
  successSubtle: SUCCESS_SUBTLE,
  warning: WARNING,
  warningSubtle: WARNING_SUBTLE,
  danger: DANGER,
  dangerSubtle: DANGER_SUBTLE,
  info: INFO,
  infoSubtle: INFO_SUBTLE,
} as const

// ---------------------------------------------------------------------------
// Email
//
// An email cannot read a CSS custom property, so it needs the same palette as
// literal hex values. Every value below is a token's own hex: this map adds no
// colour of its own, and a test (lib/design/tokens.test.ts) checks that each one
// still matches the token it names.
//
// The choices are the ones an email can defend:
//   * the card is white on the quiet surface, never the ink;
//   * body text is INK, 19.22:1 on white and 18.05:1 on the surface;
//   * the second and third lines use TEXT_MUTED (8.05:1 on white) and
//     TEXT_SUBTLE (4.90:1), so a footnote is read rather than squinted at;
//   * the one action is BRAND_600 with white text, the same 5.09:1 pair the
//     product's primary button uses.
// ---------------------------------------------------------------------------

export const EMAIL_COLOURS = {
  /** The page behind the card. */
  page: SURFACE_SUBTLE.hex,
  /** The card itself. */
  card: BACKGROUND.hex,
  /** Body text. */
  ink: INK.hex,
  /** The second line: a label, a helper sentence. */
  muted: TEXT_MUTED.hex,
  /** The third line: a footnote, a fallback link. */
  subtle: TEXT_SUBTLE.hex,
  /** The 1px rule around a box or between rows. */
  border: BORDER.hex,
  /** A quiet block: the info box, the code block, the order summary. */
  surface: SURFACE_SUBTLE.hex,
  /** A slightly stronger block, used behind the step-up code. */
  surfaceMuted: SURFACE_MUTED.hex,
  /** The primary button and the one link colour. */
  brand: BRAND_600.hex,
  /** The primary button's hover shade. Mail clients rarely honour it. */
  brandHover: BRAND_700.hex,
  /** The text on the primary button. */
  onBrand: BACKGROUND.hex,
  /** A refusal: a rejected withdrawal, a failed payout. */
  danger: DANGER.hex,
  /** The pale background behind danger text. */
  dangerSurface: DANGER_SUBTLE.hex,
  /** Something that needs a decision: a VAT return due. */
  warning: WARNING.hex,
  /** The pale background behind warning text. */
  warningSurface: WARNING_SUBTLE.hex,
  /** A completed payout. */
  success: SUCCESS.hex,
  /** The pale background behind success text. */
  successSurface: SUCCESS_SUBTLE.hex,
} as const

/** The stack an email asks for: the reader's own system font, never a download. */
export const EMAIL_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** The stack for a code: a monospace face every client already has. */
export const EMAIL_MONO_STACK = "'Courier New',Courier,monospace"

/**
 * The width an email is designed for.
 *
 * 600px is the widest a mail client reliably gives a message; the layout is a
 * single column below it, so a phone at 360px gets the same content with less
 * padding rather than a second design.
 */
export const EMAIL_MAX_WIDTH = 600

/**
 * One step of the spacing scale, in pixels, for an email's inline styles.
 *
 * Read from SPACING_SCALE so the two cannot drift: an email cannot use a
 * Tailwind class, and a number typed twice is a number that will disagree.
 */
export function emailSpacePx(token: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl"): number {
  const step = SPACING_SCALE.find((entry) => entry.token === token)

  if (step === undefined) {
    throw new Error(`Not a spacing token: ${token}`)
  }

  return step.px
}

/** One radius from RADII, in pixels, for an email's inline styles. */
export function emailRadiusPx(token: "sm" | "md" | "lg" | "xl"): number {
  const step = RADII.find((entry) => entry.token === token)

  if (step === undefined) {
    throw new Error(`Not a radius token: ${token}`)
  }

  return step.px
}
