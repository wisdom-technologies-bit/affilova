import { Section, Text } from "@react-email/components"

import {
  EMAIL_COLOURS,
  EMAIL_FONT_STACK,
  EMAIL_MONO_STACK,
  emailRadiusPx,
  emailSpacePx,
} from "@/lib/design/tokens"

// A short code a person reads off a screen and types into another one.
//
// Large, monospace and widely spaced, because the failure mode here is a
// misread digit: 0 against O, 1 against l. The digits keep their leading zeros
// (the value is a string, never a number) and the block is centred so it is the
// first thing the eye lands on.

export interface CodeProps {
  code: string
  /** What the code is for, in one line above it. */
  label?: string
}

export function Code({ code, label }: CodeProps) {
  return (
    <Section style={boxStyle}>
      {label === undefined ? null : <Text style={labelStyle}>{label}</Text>}
      <Text style={codeStyle}>{code}</Text>
    </Section>
  )
}

const boxStyle = {
  backgroundColor: EMAIL_COLOURS.surfaceMuted,
  border: `1px solid ${EMAIL_COLOURS.border}`,
  borderRadius: `${emailRadiusPx("md")}px`,
  padding: `${emailSpacePx("lg")}px ${emailSpacePx("md")}px`,
  margin: `0 0 ${emailSpacePx("lg")}px`,
  textAlign: "center" as const,
} as const

const labelStyle = {
  margin: `0 0 ${emailSpacePx("sm")}px`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "18px",
  color: EMAIL_COLOURS.muted,
} as const

const codeStyle = {
  margin: 0,
  fontFamily: EMAIL_MONO_STACK,
  fontSize: "30px",
  lineHeight: "36px",
  fontWeight: 700,
  letterSpacing: "8px",
  color: EMAIL_COLOURS.ink,
} as const
