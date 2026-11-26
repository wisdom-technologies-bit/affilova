"use client"

import { useState, type FormEvent } from "react"

import { becomeVendorAction, type OnboardingFieldErrors } from "@/app/start/actions"
import { FormAlert } from "@/components/auth/form-alert"
import {
  vendorBusinessNameError,
  vendorPhoneError,
  vendorSlugError,
  vendorSupportEmailError,
} from "@/components/auth/onboarding-validation"
import { SubmitButton } from "@/components/auth/submit-button"
import { TextField } from "@/components/auth/text-field"
import { ArrowRight, CheckCircle } from "@/components/ds/icons"
import { Section } from "@/components/ds/section"

import { ContinueLink, TermsNotice } from "./terms-notice"

// The vendor onboarding form, in three sections: who you are, where your store
// lives, and how a buyer reaches you.
//
// The store address section shows the public URL as it is typed. The URL is built
// from appUrl() on the server and passed in, so the host is never typed twice and
// a preview can never point at a host the app does not serve. The value the person
// types is the slug on its own; the domain is never part of it.
//
// The messages under a field are advice shown on blur. They do not decide whether
// the form submits: the server action still parses with the schema.

const UNEXPECTED_FAILURE = "Something went wrong. Please try again."

export interface VendorFormProps {
  /** The public store URL up to the slug, e.g. "https://affilova.com/store/". */
  storeUrlPrefix: string
  /** Where "Add your first product" goes, built with appUrl on the server. */
  nextHref: string
}

type Touched = {
  businessName: boolean
  slug: boolean
  supportEmail: boolean
  phone: boolean
}

/** The panel shown once the vendor role has been granted. */
export function VendorDonePanel({ storeUrl, nextHref }: { storeUrl: string; nextHref: string }) {
  return (
    <div>
      <CheckCircle size="lg" tone="success" className="text-success" />

      <h1 className="mt-4 text-h1 text-foreground">Set up your store</h1>
      <p className="mt-2 text-body text-text-muted">
        Your vendor account is ready. Your store address is{" "}
        <span className="font-medium text-foreground">{storeUrl}</span>.
      </p>

      <div className="mt-6 rounded-lg border border-border p-5">
        <h2 className="text-h3 text-foreground">Next: add your first product</h2>
        <p className="mt-1.5 text-dense text-text-muted">
          A product needs a name, a price and a file. It goes live once the file has been scanned.
        </p>
        <ContinueLink href={nextHref}>
          Add your first product
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

export function VendorForm({ storeUrlPrefix, nextHref }: VendorFormProps) {
  const [businessName, setBusinessName] = useState("")
  const [slug, setSlug] = useState("")
  const [supportEmail, setSupportEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [touched, setTouched] = useState<Touched>({
    businessName: false,
    slug: false,
    supportEmail: false,
    phone: false,
  })
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  function markTouched(field: keyof Touched): void {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const businessNameMessage =
    fieldErrors.businessName ?? (touched.businessName ? vendorBusinessNameError(businessName) : undefined)
  const slugMessage = fieldErrors.slug ?? (touched.slug ? vendorSlugError(slug) : undefined)
  const supportEmailMessage =
    fieldErrors.supportEmail ?? (touched.supportEmail ? vendorSupportEmailError(supportEmail) : undefined)
  const phoneMessage = fieldErrors.phone ?? (touched.phone ? vendorPhoneError(phone) : undefined)

  const previewSlug = slug.trim().toLowerCase()
  const storeUrl = `${storeUrlPrefix}${previewSlug === "" ? "your-store" : previewSlug}`

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
    return <VendorDonePanel storeUrl={storeUrl} nextHref={nextHref} />
  }

  return (
    <div>
      <h1 className="text-h1 text-foreground">Set up your store</h1>
      <p className="mt-2 text-body text-text-muted">Tell us about your business.</p>

      {formError !== null ? (
        <div className="mt-6">
          <FormAlert key={formError} variant="error" autoFocus>
            {formError}
          </FormAlert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
        <Section variant="plain" title="Business details">
          <TextField
            id="vendor-business-name"
            name="businessName"
            label="Business name"
            hint="The name buyers see on your store and on their receipt."
            autoComplete="organization"
            required
            value={businessName}
            error={businessNameMessage}
            onBlur={() => markTouched("businessName")}
            onChange={(event) => setBusinessName(event.target.value)}
          />
        </Section>

        <Section
          variant="plain"
          title="Store address"
          description="This is the link you share. It cannot be changed after you create the store."
        >
          <TextField
            id="vendor-slug"
            name="slug"
            label="Store address"
            hint="Lowercase letters, numbers and hyphens."
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={slug}
            error={slugMessage}
            onBlur={() => markTouched("slug")}
            onChange={(event) => setSlug(event.target.value)}
          />

          <div className="mt-3">
            <p className="text-small font-medium text-foreground">Public address</p>
            <p
              aria-live="polite"
              className="mt-1.5 break-all rounded-md border border-border bg-surface-subtle px-3 py-2.5 text-dense text-text-muted"
            >
              {storeUrl}
            </p>
          </div>
        </Section>

        <Section variant="plain" title="Contact">
          <div className="space-y-4">
            <TextField
              id="vendor-support-email"
              name="supportEmail"
              label="Support email"
              hint="Where a buyer writes when something is wrong with an order."
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={supportEmail}
              error={supportEmailMessage}
              onBlur={() => markTouched("supportEmail")}
              onChange={(event) => setSupportEmail(event.target.value)}
            />

            <TextField
              id="vendor-phone"
              name="phone"
              label="Phone (optional)"
              hint="Only used if a buyer asks us to call you about an order."
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              error={phoneMessage}
              onBlur={() => markTouched("phone")}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </Section>

        <TermsNotice role="vendor" />

        <SubmitButton pending={pending}>Create store</SubmitButton>
      </form>
    </div>
  )
}
