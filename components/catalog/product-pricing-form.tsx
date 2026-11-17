"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { describedBy, FormField } from "@/components/forms/form-field"
import { useUnsavedChanges } from "@/components/catalog/use-unsaved-changes"
import { updateProductAction } from "@/lib/catalog/actions/vendor"
import type { ProductDetail } from "@/lib/catalog/action-types"
import { splitActionError, type ProductFieldName } from "@/lib/catalog/field-errors"
import {
  affiliateApprovalLabel,
  formatPercent,
  koboToNairaInput,
  percentToBps,
  REFUND_WINDOW_OPTIONS,
  refundWindowLabel,
} from "@/lib/catalog/format"
import { nairaToKobo } from "@/lib/catalog/money"

// Price, what affiliates earn, and the promises that come with the sale.
//
// Naira in, kobo stored: the two conversions are nairaToKobo and
// koboToNairaInput, and nothing here uses a float for money.

const MIN_PRICE_KOBO = 10_000
const MAX_PRICE_KOBO = 1_000_000_000

type Errors = Partial<Record<ProductFieldName, string>>

const APPROVALS = ["open", "approval", "invite"] as const

type Approval = (typeof APPROVALS)[number]

type Values = {
  priceNaira: string
  compareAtNaira: string
  commissionPercent: string
  approval: Approval
  refundHours: string
  maxDownloads: string
}

function toApproval(value: string): Approval {
  return value === "approval" ? "approval" : value === "invite" ? "invite" : "open"
}

export function ProductPricingForm({ product }: { product: ProductDetail }) {
  const router = useRouter()

  const initial: Values = {
    priceNaira: koboToNairaInput(product.priceKobo),
    compareAtNaira: koboToNairaInput(product.compareAtPriceKobo),
    commissionPercent: formatPercent(product.commissionBps),
    approval: toApproval(product.affiliateApproval ?? "open"),
    refundHours: String(product.refundWindowHours),
    maxDownloads: String(product.maxDownloads),
  }

  const [values, setValues] = useState<Values>(initial)
  const [saved, setSaved] = useState<Values>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = (Object.keys(initial) as (keyof Values)[]).some(
    (key) => values[key] !== saved[key],
  )

  useUnsavedChanges(dirty)

  function update(next: Partial<Values>): void {
    setValues((current) => ({ ...current, ...next }))
    setNotice(null)
  }

  async function save(): Promise<void> {
    const found: Errors = {}

    const priceKobo = nairaToKobo(values.priceNaira)

    if (priceKobo === null || priceKobo < MIN_PRICE_KOBO || priceKobo > MAX_PRICE_KOBO) {
      found.price = "Enter a price of at least ₦100 and at most ₦10,000,000."
    }

    const compareAt = values.compareAtNaira.trim()
    const compareAtKobo = compareAt === "" ? null : nairaToKobo(compareAt)

    if (compareAt !== "" && compareAtKobo === null) {
      found.compareAtPrice = "Enter a naira amount, or leave it empty."
    } else if (compareAtKobo !== null && priceKobo !== null && compareAtKobo <= priceKobo) {
      found.compareAtPrice = "The compare-at price must be higher than the price."
    }

    const commissionBps = percentToBps(values.commissionPercent)

    if (commissionBps === null) {
      found.commission = "Enter a whole percentage between 5 and 80."
    }

    const maxDownloads = Number(values.maxDownloads)

    if (!/^\d+$/.test(values.maxDownloads.trim()) || maxDownloads < 1 || maxDownloads > 100) {
      found.downloads = "The download limit must be a whole number between 1 and 100."
    }

    const refundHours = Number(values.refundHours)

    setErrors(found)
    setFormError(null)

    if (
      Object.keys(found).length > 0 ||
      priceKobo === null ||
      commissionBps === null ||
      !Number.isInteger(refundHours)
    ) {
      return
    }

    setSaving(true)

    try {
      const result = await updateProductAction({
        productId: product.id,
        fields: {
          priceKobo,
          compareAtPriceKobo: compareAtKobo,
          commissionBps,
          affiliateApproval: values.approval,
          refundWindowHours: refundHours,
          maxDownloads,
        },
      })

      if (!result.ok) {
        const split = splitActionError(result.error)

        if (split.field === null) {
          setFormError(split.message)
        } else {
          setErrors({ [split.field]: split.message })
        }

        return
      }

      setSaved({ ...values })
      setNotice("Saved.")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className="space-y-5"
    >
      {formError === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="pricing-price"
          label="Price in naira"
          required
          error={errors.price ?? null}
          hint="₦100 minimum. Customers pay this."
        >
          <input
            id="pricing-price"
            type="text"
            inputMode="decimal"
            value={values.priceNaira}
            onChange={(event) => update({ priceNaira: event.target.value })}
            aria-describedby={describedBy("pricing-price")}
            aria-invalid={errors.price !== undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </FormField>

        <FormField
          id="pricing-compare-at"
          label="Compare-at price in naira"
          error={errors.compareAtPrice ?? null}
          hint="Optional. Must be higher than the price. Shown struck through."
        >
          <input
            id="pricing-compare-at"
            type="text"
            inputMode="decimal"
            value={values.compareAtNaira}
            onChange={(event) => update({ compareAtNaira: event.target.value })}
            aria-describedby={describedBy("pricing-compare-at")}
            aria-invalid={errors.compareAtPrice !== undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </FormField>

        <FormField
          id="pricing-commission"
          label="Affiliate commission, percent"
          required
          error={errors.commission ?? null}
          hint="A whole number from 5 to 80."
        >
          <input
            id="pricing-commission"
            type="text"
            inputMode="numeric"
            value={values.commissionPercent}
            onChange={(event) => update({ commissionPercent: event.target.value })}
            aria-describedby={describedBy("pricing-commission")}
            aria-invalid={errors.commission !== undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </FormField>

        <FormField
          id="pricing-downloads"
          label="Maximum downloads per purchase"
          required
          error={errors.downloads ?? null}
          hint="Between 1 and 100."
        >
          <input
            id="pricing-downloads"
            type="text"
            inputMode="numeric"
            value={values.maxDownloads}
            onChange={(event) => update({ maxDownloads: event.target.value })}
            aria-describedby={describedBy("pricing-downloads")}
            aria-invalid={errors.downloads !== undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </FormField>

        <FormField
          id="pricing-approval"
          label="Affiliates"
          required
          error={errors.approval ?? null}
          hint="Who may promote this product."
        >
          <select
            id="pricing-approval"
            value={values.approval}
            onChange={(event) => update({ approval: toApproval(event.target.value) })}
            aria-describedby={describedBy("pricing-approval")}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            {APPROVALS.map((approval) => (
              <option key={approval} value={approval}>
                {affiliateApprovalLabel(approval)}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          id="pricing-refund"
          label="Refund window"
          required
          error={errors.refund ?? null}
          hint="The shortest window allowed is 24 hours."
        >
          <select
            id="pricing-refund"
            value={values.refundHours}
            onChange={(event) => update({ refundHours: event.target.value })}
            aria-describedby={describedBy("pricing-refund")}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            {REFUND_WINDOW_OPTIONS.map((hours) => (
              <option key={hours} value={String(hours)}>
                {refundWindowLabel(hours)}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save pricing"}
        </button>

        <p aria-live="polite" className="text-sm">
          {dirty ? (
            <span className="font-medium text-brand-ink">Unsaved changes</span>
          ) : notice === null ? null : (
            <span className="text-muted-foreground">{notice}</span>
          )}
        </p>
      </div>
    </form>
  )
}
