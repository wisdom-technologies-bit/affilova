import type { ReactElement } from "react"

import { EmailLayout, Paragraph, PrimaryButton } from "@/emails/components"
import type { BrandingUrls } from "@/emails/types"

// The four Supabase Auth emails.
//
// These are not sent by this application: Supabase sends them, and the HTML has
// to be pasted into the dashboard. So they cannot be rendered with real values
// here. They are rendered with Supabase's own template variables, exactly as
// docs/auth-setup.md documents them, and scripts/export-auth-emails.ts writes the
// four files an owner pastes in:
//
//   {{ .SiteURL }}      the project's Site URL, from Authentication, URL Configuration
//   {{ .TokenHash }}    the one-time token /auth/confirm verifies
//   {{ .Email }}        the address the message is going to
//   {{ .NewEmail }}     the address being added (Change Email only)
//
// {{ .ConfirmationURL }} is deliberately not used. The app verifies token_hash
// itself, and Supabase's own confirmation URL would bypass /auth/confirm. That is
// the same decision docs/auth-setup.md records.
//
// Everything else is the shared layout: the same logo, the same footer, the same
// inline styles. An auth email that looked different from a receipt would be the
// one a person hesitates over.

/** The values Supabase substitutes. Never real addresses or tokens. */
export interface AuthTemplateVariables {
  siteUrl: string
  tokenHash: string
  email: string
  newEmail?: string
}

/** What a template needs: the variables plus the addresses the footer links to. */
export interface AuthEmailProps extends AuthTemplateVariables {
  branding: BrandingUrls
}

/** One of the four links, in the one shape /auth/confirm accepts. */
export function authConfirmUrl(input: {
  siteUrl: string
  tokenHash: string
  type: AuthLinkType
  next?: string
}): string {
  const base = `${input.siteUrl}/auth/confirm?token_hash=${input.tokenHash}&type=${input.type}`

  return input.next === undefined ? base : `${base}&next=${input.next}`
}

export type AuthLinkType = "signup" | "magiclink" | "recovery" | "email_change"

/**
 * The sample values: the literal variables, so a rendered file is a template
 * Supabase can use rather than a page about a fictional person.
 */
export const authSampleBranding: BrandingUrls = {
  siteUrl: "{{ .SiteURL }}",
  contactUrl: "{{ .SiteURL }}/contact",
}

export const authTemplateVariablesSample: AuthTemplateVariables = {
  siteUrl: "{{ .SiteURL }}",
  tokenHash: "{{ .TokenHash }}",
  email: "{{ .Email }}",
  newEmail: "{{ .NewEmail }}",
}

export const CONFIRM_SIGNUP_SUBJECT = "Confirm your Affilova email address"

export function ConfirmSignup(props: AuthEmailProps) {
  const url = authConfirmUrl({ siteUrl: props.siteUrl, tokenHash: props.tokenHash, type: "signup" })

  return (
    <EmailLayout
      branding={props.branding}
      heading="Confirm your email address"
      previewText="Confirm your email address to finish creating your Affilova account"
      reason="You are receiving this because this address was used to sign up to Affilova."
    >
      <Paragraph>
        Thanks for signing up to Affilova. Confirm <strong>{props.email}</strong> to finish creating
        your account.
      </Paragraph>

      <PrimaryButton href={url} label="Confirm my email" />

      <Paragraph>
        If you did not sign up, you can ignore this email and the address will not be used.
      </Paragraph>
    </EmailLayout>
  )
}

export const MAGIC_LINK_SUBJECT = "Your Affilova sign-in link"

export function MagicLink(props: AuthEmailProps) {
  const url = authConfirmUrl({ siteUrl: props.siteUrl, tokenHash: props.tokenHash, type: "magiclink" })

  return (
    <EmailLayout
      branding={props.branding}
      heading="Your sign-in link"
      previewText="Your one-time sign-in link for Affilova"
      reason="You are receiving this because a sign-in link was requested for this address."
    >
      <Paragraph>Use this link to sign in to Affilova. The link can only be used once.</Paragraph>

      <PrimaryButton href={url} label="Sign in to Affilova" />

      <Paragraph>If you did not request this, you can ignore this email.</Paragraph>
    </EmailLayout>
  )
}

export const RESET_PASSWORD_SUBJECT = "Reset your Affilova password"

export function ResetPassword(props: AuthEmailProps) {
  const url = authConfirmUrl({
    siteUrl: props.siteUrl,
    tokenHash: props.tokenHash,
    type: "recovery",
    next: "/auth/reset-password",
  })

  return (
    <EmailLayout
      branding={props.branding}
      heading="Reset your password"
      previewText="Choose a new password for your Affilova account"
      reason="You are receiving this because a password reset was requested for this address."
    >
      <Paragraph>
        We received a request to reset the password for your Affilova account. Choose a new password
        with the button below.
      </Paragraph>

      <PrimaryButton href={url} label="Choose a new password" />

      <Paragraph>
        If you did not request this, you can ignore this email. Your password has not changed.
      </Paragraph>
    </EmailLayout>
  )
}

export const CHANGE_EMAIL_SUBJECT = "Confirm your new Affilova email address"

export function ChangeEmail(props: AuthEmailProps) {
  const url = authConfirmUrl({
    siteUrl: props.siteUrl,
    tokenHash: props.tokenHash,
    type: "email_change",
  })

  return (
    <EmailLayout
      branding={props.branding}
      heading="Confirm your new email address"
      previewText="Confirm the new address on your Affilova account"
      reason="You are receiving this because the email address on your Affilova account is being changed."
    >
      <Paragraph>
        We received a request to change the email address on your Affilova account to{" "}
        <strong>{props.newEmail}</strong>.
      </Paragraph>

      <PrimaryButton href={url} label="Confirm new email address" />

      <Paragraph>If you did not request this, you can ignore this email.</Paragraph>
    </EmailLayout>
  )
}

export const confirmSignupSample: AuthEmailProps = {
  ...authTemplateVariablesSample,
  branding: authSampleBranding,
}

/** The four files the export script writes, in the order the docs list them. */
export const AUTH_EMAIL_FILES: readonly {
  /** The file name under emails/dist. */
  file: string
  /** The Supabase dashboard template this file replaces. */
  template: string
  subject: string
  component: (props: AuthEmailProps) => ReactElement
}[] = [
  { file: "supabase-confirm-signup.html", template: "Confirm signup", subject: CONFIRM_SIGNUP_SUBJECT, component: ConfirmSignup },
  { file: "supabase-magic-link.html", template: "Magic Link", subject: MAGIC_LINK_SUBJECT, component: MagicLink },
  { file: "supabase-reset-password.html", template: "Reset Password", subject: RESET_PASSWORD_SUBJECT, component: ResetPassword },
  { file: "supabase-change-email.html", template: "Change Email Address", subject: CHANGE_EMAIL_SUBJECT, component: ChangeEmail },
]
