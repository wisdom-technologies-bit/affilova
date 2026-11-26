import { Column, Row, Section, Text } from "@react-email/components"

import { EMAIL_COLOURS, EMAIL_FONT_STACK, emailRadiusPx, emailSpacePx } from "@/lib/design/tokens"

// The numbers of a transaction, as a label and a value per row.
//
// Two columns rather than a sentence: an amount a person is checking against
// their bank is easier to find when it sits on the right, and the value keeps
// its own line in the plain-text version instead of being buried mid-sentence.

export interface OrderSummaryRow {
  label: string
  value: string
}

export interface OrderSummaryProps {
  rows: readonly OrderSummaryRow[]
  /** A closing line inside the box: what a fee is, when money arrives. */
  footnote?: string
}

export function OrderSummary({ rows, footnote }: OrderSummaryProps) {
  return (
    <Section style={boxStyle}>
      {rows.map((row) => (
        <Row key={row.label}>
          <Column style={labelColumnStyle}>
            <Text style={labelStyle}>{row.label}</Text>
          </Column>
          <Column style={valueColumnStyle}>
            <Text style={valueStyle}>{row.value}</Text>
          </Column>
        </Row>
      ))}
      {footnote === undefined ? null : <Text style={footnoteStyle}>{footnote}</Text>}
    </Section>
  )
}

const boxStyle = {
  backgroundColor: EMAIL_COLOURS.surface,
  border: `1px solid ${EMAIL_COLOURS.border}`,
  borderRadius: `${emailRadiusPx("md")}px`,
  padding: `${emailSpacePx("xs")}px ${emailSpacePx("lg")}px`,
  margin: `0 0 ${emailSpacePx("lg")}px`,
} as const

const labelColumnStyle = { width: "55%", verticalAlign: "top" } as const

const valueColumnStyle = { width: "45%", textAlign: "right" as const, verticalAlign: "top" } as const

const labelStyle = {
  margin: `${emailSpacePx("sm")}px 0`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "14px",
  lineHeight: "20px",
  color: EMAIL_COLOURS.muted,
} as const

const valueStyle = {
  margin: `${emailSpacePx("sm")}px 0`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "14px",
  lineHeight: "20px",
  fontWeight: 600,
  color: EMAIL_COLOURS.ink,
} as const

const footnoteStyle = {
  margin: `0 0 ${emailSpacePx("sm")}px`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "19px",
  color: EMAIL_COLOURS.subtle,
} as const
