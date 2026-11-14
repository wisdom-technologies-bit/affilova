"use client"

import { useState, type FormEvent } from "react"

import { becomeAffiliateAction, type OnboardingFieldErrors } from "@/app/start/actions"
import { FormAlert } from "@/components/auth/form-alert"
import { SubmitButton } from "@/components/auth/submit-button"
import { TextField } from "@/components/auth/text-field"
import {
  PROMOTION_CHANNELS,
  type PromotionChannel,
} from "@/lib/identity/onboarding-schemas"

import { ContinueLink, TermsNotice } from "./terms-notice"

// The affiliate onboarding form: a username and the channels the person
// promotes on. The channel list is imported from the schema, so the checkboxes
// and the rule that validates them cannot drift apart.

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

export function AffiliateForm() {
  const [username, setUsername] = useState("")
  const [channels, setChannels] = useState<PromotionChannel[]>([])
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  function toggleChannel(channel: PromotionChannel): void {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel],
    )
  }

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
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Set up your affiliate profile
        </h1>
        <p className="mt-2 text-sm text-slate-600">Your affiliate account is ready.</p>
        <div className="mt-6">
          <ContinueLink href="/start">Continue</ContinueLink>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        Set up your affiliate profile
      </h1>
      <p className="mt-1 text-sm text-slate-600">Choose a username and your channels.</p>

      {formError !== null ? (
        <div className="mt-5">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <TextField
          id="affiliate-username"
          name="username"
          label="Username"
          hint="Letters, numbers and underscores"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          error={fieldErrors.username}
          onChange={(event) => setUsername(event.target.value)}
        />

        <fieldset>
          <legend className="block text-sm font-medium text-slate-900">Promotion channels</legend>
          <p className="mt-1.5 text-xs text-slate-500">Where you promote products.</p>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            {PROMOTION_CHANNELS.map((channel) => (
              <label
                key={channel}
                htmlFor={`affiliate-channel-${channel}`}
                className="flex items-center gap-2 text-sm text-slate-700"
              >
                <input
                  id={`affiliate-channel-${channel}`}
                  name="promotionChannels"
                  type="checkbox"
                  value={channel}
                  checked={channels.includes(channel)}
                  onChange={() => toggleChannel(channel)}
                  className="size-4 shrink-0 rounded border-slate-300 accent-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                />
                {CHANNEL_LABELS[channel]}
              </label>
            ))}
          </div>

          {fieldErrors.promotionChannels !== undefined ? (
            <p className="mt-1.5 text-xs text-red-700">{fieldErrors.promotionChannels}</p>
          ) : null}
        </fieldset>

        <TermsNotice />

        <SubmitButton pending={pending}>Create affiliate profile</SubmitButton>
      </form>
    </div>
  )
}
