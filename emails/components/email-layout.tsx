import { Body, Container, Head, Html, Img, Link, Preview, Section, Text } from "@react-email/components"
import type { ReactNode } from "react"

import { Heading } from "@/emails/components/heading"
import { SecondaryText } from "@/emails/components/secondary-text"
import type { BrandingUrls } from "@/emails/types"
import {
  EMAIL_COLOURS,
  EMAIL_FONT_STACK,
  EMAIL_MAX_WIDTH,
  emailRadiusPx,
  emailSpacePx,
} from "@/lib/design/tokens"
import { LEGAL, legalIdentityLine } from "@/lib/site-config"

// The frame every message is sent in.
//
// What is fixed here, so no template has to remember it:
//   * `lang="en"` on the html element, and a charset, so a client does not guess;
//   * a preview line, the sentence a mail client shows next to the subject;
//   * the logo from the public site, with alt text, and no other image;
//   * one heading, an h1, from the `heading` prop;
//   * the footer: why the message arrived, how to reach a person, and the legal
//     identity line from lib/site-config.ts when the owner has set one.
//
// What is never here: a tracking pixel, an open counter, a web font, a
// stylesheet, or a link that is not absolute https. Every style is inline,
// because a client that strips the head must still show a readable message.

/** The logo, as the public site serves it. */
export const EMAIL_LOGO_PATH = "/brand/email/affilova-logo-email.png"

/** The alt text. A logo with no words beside it is a broken image to a reader. */
export const EMAIL_LOGO_ALT = "Affilova"

/** The rendered width of the logo. The file is 2x for a retina screen. */
export const EMAIL_LOGO_WIDTH = 140

export interface EmailLayoutProps {
  branding: BrandingUrls
  /** The one heading of the message. */
  heading: string
  /** The line a mail client shows next to the subject. */
  previewText: string
  /** Why this message arrived. The last sentence of the card. */
  reason: string
  children: ReactNode
}

export function EmailLayout({ branding, heading, previewText, reason, children }: EmailLayoutProps) {
  const logoUrl = `${trimTrailingSlashes(branding.siteUrl)}${EMAIL_LOGO_PATH}`
  const legalLine = legalIdentityLine(LEGAL)
  const supportEmail = LEGAL.supportEmail.trim()

  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={cardStyle}>
          <Section style={logoSectionStyle}>
            <Img
              src={logoUrl}
              alt={EMAIL_LOGO_ALT}
              width={EMAIL_LOGO_WIDTH}
              style={logoStyle}
            />
          </Section>

          <Heading>{heading}</Heading>

          {children}

          {/* A rule, as a bordered block: React Email's Hr ships a hex of its own. */}
          <Section data-skip-in-text="true" style={ruleStyle} />

          <SecondaryText>{reason}</SecondaryText>
          <SecondaryText>{contactLine(supportEmail, branding.contactUrl)}</SecondaryText>
          {legalLine === "" ? null : <Text style={legalStyle}>{legalLine}</Text>}
        </Container>
      </Body>
    </Html>
  )
}

/** The support address as words, not a mailto: the one link here is https. */
function contactLine(supportEmail: string, contactUrl: string): ReactNode {
  return (
    <>
      Questions? {supportEmail === "" ? null : `Write to ${supportEmail} or `}
      <Link href={contactUrl} style={linkStyle}>
        use the contact page
      </Link>
      .
    </>
  )
}

/** A site URL is configured with or without a trailing slash; both work. */
function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "")
}

const bodyStyle = {
  margin: 0,
  padding: `${emailSpacePx("xl")}px ${emailSpacePx("md")}px`,
  backgroundColor: EMAIL_COLOURS.page,
  fontFamily: EMAIL_FONT_STACK,
} as const

const cardStyle = {
  maxWidth: `${EMAIL_MAX_WIDTH}px`,
  margin: "0 auto",
  padding: `${emailSpacePx("2xl")}px ${emailSpacePx("xl")}px`,
  backgroundColor: EMAIL_COLOURS.card,
  border: `1px solid ${EMAIL_COLOURS.border}`,
  borderRadius: `${emailRadiusPx("lg")}px`,
} as const

const logoSectionStyle = {
  margin: `0 0 ${emailSpacePx("xl")}px`,
} as const

const logoStyle = {
  display: "block",
  border: 0,
  maxWidth: "100%",
  height: "auto",
} as const

const ruleStyle = {
  borderTop: `1px solid ${EMAIL_COLOURS.border}`,
  margin: `${emailSpacePx("xl")}px 0 ${emailSpacePx("md")}px`,
  fontSize: "1px",
  lineHeight: "1px",
} as const

const linkStyle = {
  color: EMAIL_COLOURS.brand,
  textDecoration: "underline",
} as const

const legalStyle = {
  margin: `${emailSpacePx("md")}px 0 0`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "12px",
  lineHeight: "18px",
  color: EMAIL_COLOURS.subtle,
} as const
