"use client"

import { useState, type FormEvent } from "react"

import { becomeVendorAction, type OnboardingFieldErrors } from "@/app/start/actions"
import { FormAlert } from "@/components/auth/form-alert"
import { SubmitButton } from "@/components/auth/submit-button"
import { TextField } from "@/components/auth/text-field"

import { ContinueLink, TermsNotice } from "./terms-notice"

// The vendor onboarding form.
//
// The address hint ("affilova.com/store/") is helper text only: the value the
// user types is the slug on its own, and the domain is never part of it.
//
// The success state replaces the form but keeps the heading, so the page always
// has exactly one h1.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."

export function VendorForm() {
  const [businessName, setBusinessName] = useState("")
  const [slug, setSlug] = useState("")
  const [supportEmail, setSupportEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (pending) {
      return
    }

    setFormError(null)
    setFieldErrors({})
    setPending(true)

    try {
      const result = await becomeVendorAction({
        businessName,
        slug,
        supportEmail,
        phone,
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
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Set up your store</h1>
        <p className="mt-2 text-sm text-slate-600">Your vendor account is ready.</p>
        <div className="mt-6">
          <ContinueLink href="/start">Continue</ContinueLink>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Set up your store</h1>
      <p className="mt-1 text-sm text-slate-600">Tell us about your business.</p>

      {formError !== null ? (
        <div className="mt-5">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
        <TextField
          id="vendor-business-name"
          name="businessName"
          label="Business name"
          autoComplete="organization"
          required
          value={businessName}
          error={fieldErrors.businessName}
          onChange={(event) => setBusinessName(event.target.value)}
        />

        <TextField
          id="vendor-slug"
          name="slug"
          label="Store address"
          hint="affilova.com/store/"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={slug}
          error={fieldErrors.slug}
          onChange={(event) => setSlug(event.target.value)}
        />

        <TextField
          id="vendor-support-email"
          name="supportEmail"
          label="Support email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={supportEmail}
          error={fieldErrors.supportEmail}
          onChange={(event) => setSupportEmail(event.target.value)}
        />

        <TextField
          id="vendor-phone"
          name="phone"
          label="Phone (optional)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          error={fieldErrors.phone}
          onChange={(event) => setPhone(event.target.value)}
        />

        <TermsNotice />

        <SubmitButton pending={pending}>Create store</SubmitButton>
      </form>
    </div>
  )
}
