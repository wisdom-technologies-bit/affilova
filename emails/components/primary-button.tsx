import { Button, Link, Section, Text } from "@react-email/components"

import { EMAIL_COLOURS, EMAIL_FONT_STACK, emailRadiusPx, emailSpacePx } from "@/lib/design/tokens"

// The one action of a message.
//
// Bulletproof here means two things: the button is a real anchor styled with
// padding rather than an image, so a client that strips CSS still shows a
// clickable word; and the same URL is printed underneath as text, so a client
// that mangles the button (or a person who reads in plain text) still has the
// address. That fallback is not decoration: it is the link.
//
// Brand 600 with white text is 5.09:1. The padding puts the control at 52px
// high, above the 44px a thumb needs.

export interface PrimaryButtonProps {
  href: string
  label: string
}

export function PrimaryButton({ href, label }: PrimaryButtonProps) {
  return (
    <Section style={sectionStyle}>
      <Button href={href} style={buttonStyle}>
        {label}
      </Button>
      <Text style={fallbackStyle}>
        If the button does not work, copy this link into your browser:{" "}
        <Link href={href} style={fallbackLinkStyle}>
          {href}
        </Link>
      </Text>
    </Section>
  )
}

const sectionStyle = {
  margin: `0 0 ${emailSpacePx("xl")}px`,
} as const

const buttonStyle = {
  backgroundColor: EMAIL_COLOURS.brand,
  color: EMAIL_COLOURS.onBrand,
  borderRadius: `${emailRadiusPx("md")}px`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "15px",
  fontWeight: 600,
  lineHeight: "24px",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  minHeight: "44px",
  padding: `${emailSpacePx("md")}px ${emailSpacePx("xl")}px`,
} as const

const fallbackStyle = {
  margin: `${emailSpacePx("md")}px 0 0`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "20px",
  color: EMAIL_COLOURS.subtle,
} as const

const fallbackLinkStyle = {
  color: EMAIL_COLOURS.brand,
  wordBreak: "break-all" as const,
} as const
