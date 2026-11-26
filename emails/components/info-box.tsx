import { Section, Text } from "@react-email/components"
import type { ReactNode } from "react"

import { EMAIL_COLOURS, EMAIL_FONT_STACK, emailRadiusPx, emailSpacePx } from "@/lib/design/tokens"

// A quiet block that holds one thought: how long a link lasts, what a refund
// window is, why a withdrawal came back.
//
// Four tones, each a text colour on its own pale background from the token set,
// so every one of them is measured: success 6.7:1, warning 8.0:1, danger 5.6:1
// and info 7.0:1 on their own surfaces. The tone is never the only signal: the
// block carries words.

export type InfoBoxTone = "info" | "success" | "warning" | "danger"

export interface InfoBoxProps {
  tone?: InfoBoxTone
  title?: string
  children: ReactNode
}

export function InfoBox({ tone = "info", title, children }: InfoBoxProps) {
  const palette = PALETTES[tone]

  return (
    <Section style={{ ...boxStyle, backgroundColor: palette.background, borderColor: palette.border }}>
      {title === undefined ? null : <Text style={{ ...titleStyle, color: palette.text }}>{title}</Text>}
      <Text style={{ ...bodyStyle, color: palette.text }}>{children}</Text>
    </Section>
  )
}

interface Palette {
  background: string
  border: string
  text: string
}

const PALETTES: Readonly<Record<InfoBoxTone, Palette>> = {
  info: {
    background: EMAIL_COLOURS.surface,
    border: EMAIL_COLOURS.border,
    text: EMAIL_COLOURS.muted,
  },
  success: {
    background: EMAIL_COLOURS.successSurface,
    border: EMAIL_COLOURS.successSurface,
    text: EMAIL_COLOURS.success,
  },
  warning: {
    background: EMAIL_COLOURS.warningSurface,
    border: EMAIL_COLOURS.warningSurface,
    text: EMAIL_COLOURS.warning,
  },
  danger: {
    background: EMAIL_COLOURS.dangerSurface,
    border: EMAIL_COLOURS.dangerSurface,
    text: EMAIL_COLOURS.danger,
  },
}

const boxStyle = {
  border: `1px solid ${EMAIL_COLOURS.border}`,
  borderRadius: `${emailRadiusPx("md")}px`,
  padding: `${emailSpacePx("md")}px ${emailSpacePx("lg")}px`,
  margin: `0 0 ${emailSpacePx("lg")}px`,
} as const

const titleStyle = {
  margin: `0 0 ${emailSpacePx("xs")}px`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "14px",
  lineHeight: "20px",
  fontWeight: 600,
} as const

const bodyStyle = {
  margin: 0,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "14px",
  lineHeight: "21px",
} as const
