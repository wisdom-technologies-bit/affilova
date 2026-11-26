"use client"

import { useState, type FormEvent } from "react"

import { becomeAffiliateAction, type OnboardingFieldErrors } from "@/app/start/actions"
import { FormAlert } from "@/components/auth/form-alert"
import { affiliateChannelsError, affiliateUsernameError } from "@/components/auth/onboarding-validation"
import { SubmitButton } from "@/components/auth/submit-button"
import { TextField } from "@/components/auth/text-field"
import { ArrowRight, CheckCircle } from "@/components/ds/icons"
import { Section } from "@/components/ds/section"
import {
  PROMOTION_CHANNELS,
  type PromotionChannel,
} from "@/lib/identity/onboarding-schemas"

import { ContinueLink, TermsNotice } from "./terms-notice"

// The affiliate onboarding form: a username, then the channels the person
// promotes on.
//
// The channel list is imported from the schema, so the checkboxes and the rule
// that validates them cannot drift apart. The username is the only thing that
// becomes public, and the helper text says so.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."

const CHANNEL_LABELS: Record<PromotionChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
  telegram: "Telegram",
  blog: "Blog",
  email: "Email",
  other: "Other",
}

export interface AffiliateFormProps {
  /** Where "Browse the marketplace" goes, built with appUrl on the server. */
  nextHref: string
}

/** The panel shown once the affiliate role has been granted. */
export function AffiliateDonePanel({ username, nextHref }: { username: string; nextHref: string }) {
  return (
    <div>
      <CheckCircle size="lg" tone="success" className="text-success" />

      <h1 className="mt-4 text-h1 text-foreground">Set up your affiliate profile</h1>
      <p className="mt-2 text-body text-text-muted">
        Your affiliate account is ready. Your username is{" "}
        <span className="font-medium text-foreground">@{username}</span>.
      </p>

      <div className="mt-6 rounded-lg border border-border p-5">
        <h2 className="text-h3 text-foreground">Next: find a product to promote</h2>
        <p className="mt-1.5 text-dense text-text-muted">
          Browse the marketplace, open a product and create a link. Every click that link records is
          counted for you.
        </p>
        <ContinueLink href={nextHref}>
          Browse the marketplace
          <ArrowRight size="sm" />
        </ContinueLink>
      </div>

      <p className="mt-6 text-small text-text-muted">
        <ContinueLink href="/start" variant="text">
          Back to your account
        </ContinueLink>
      </p>
    </div>
  )
}

export function AffiliateForm({ nextHref }: AffiliateFormProps) {
  const [username, setUsername] = useState("")
  const [channels, setChannels] = useState<PromotionChannel[]>([])
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [channelsTouched, setChannelsTouched] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  function toggleChannel(channel: PromotionChannel): void {
    setChannelsTouched(true)
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel],
    )
  }

  const usernameMessage =
    fieldErrors.username ?? (usernameTouched ? affiliateUsernameError(username) : undefined)
  const channelsMessage =
    fieldErrors.promotionChannels ?? (channelsTouched ? affiliateChannelsError(channels) : undefined)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (pending) {
      return
    }

    setFormError(null)
    setFieldErrors({})
    setPending(true)

    try {
      const result = await becomeAffiliateAction({
        username,
        promotionChannels: channels,
        acceptTerms: true,
      })

      if (result.ok) {
        setDone(true)
        return
      }

      setFieldErrors(result.fieldErrors)
      setFormError(result.error)
    } catch {
      setFormError(UNEXPECTED_FAILURE)
    }

    setPending(false)
  }

  if (done) {
    return <AffiliateDonePanel username={username.trim().toLowerCase()} nextHref={nextHref} />
  }

  return (
    <div>
      <h1 className="text-h1 text-foreground">Set up your affiliate profile</h1>
      <p className="mt-2 text-body text-text-muted">Choose a username and your channels.</p>

      {formError !== null ? (
        <div className="mt-6">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
        <Section
          variant="plain"
          title="Profile"
          description="Your username is public. Vendors see it beside every link you create."
        >
          <TextField
            id="affiliate-username"
            name="username"
            label="Username"
            hint="Lowercase letters, numbers and underscores."
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            error={usernameMessage}
            onBlur={() => setUsernameTouched(true)}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Section>

        <Section
          variant="plain"
          title="Where you promote"
          description="Pick the channels you actually use. This is not shown to buyers."
        >
          <fieldset>
            <legend className="text-small font-medium text-foreground">Promotion channels</legend>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
              {PROMOTION_CHANNELS.map((channel) => (
                <label
                  key={channel}
                  htmlFor={`affiliate-channel-${channel}`}
                  className="flex min-h-11 items-center gap-2.5 text-dense text-foreground"
                >
                  <input
                    id={`affiliate-channel-${channel}`}
                    name="promotionChannels"
                    type="checkbox"
                    value={channel}
                    checked={channels.includes(channel)}
                    onChange={() => toggleChannel(channel)}
                    className="size-4 shrink-0 rounded-sm border border-border-control accent-brand-600 focus-ring"
                  />
                  {CHANNEL_LABELS[channel]}
                </label>
              ))}
            </div>

            {channelsMessage !== undefined ? (
              <p className="mt-2 text-small text-danger">{channelsMessage}</p>
            ) : null}
          </fieldset>
        </Section>

        <TermsNotice role="affiliate" />

        <SubmitButton pending={pending}>Create affiliate profile</SubmitButton>
      </form>
    </div>
  )
}
