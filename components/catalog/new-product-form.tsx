"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { describedBy, FormField } from "@/components/forms/form-field"
import { createProductDraftAction } from "@/lib/catalog/actions/vendor"
import type { ProductCategory } from "@/lib/catalog/categories"
import { splitActionError, type ProductFieldName } from "@/lib/catalog/field-errors"
import { isValidProductSlug, slugify } from "@/lib/catalog/slug"
import { nairaToKobo } from "@/lib/catalog/money"
import { percentToBps } from "@/lib/catalog/format"

// The short form that starts a product.
//
// Everything the database insists on is checked here first, with the same rules,
// so a mistake is answered in the field rather than after a round trip. Money is
// parsed with nairaToKobo and sent as kobo; nothing here divides by 100.

const MIN_PRICE_KOBO = 10_000
const MAX_PRICE_KOBO = 1_000_000_000

type Errors = Partial<Record<ProductFieldName, string>>

function validate(input: {
  title: string
  slug: string
  categorySlug: string
  shortDescription: string
  priceNaira: string
  commissionPercent: string
}): { errors: Errors; priceKobo: number | null; commissionBps: number | null } {
  const errors: Errors = {}

  const title = input.title.trim()

  if (title.length < 3 || title.length > 120) {
    errors.title = "The title must be between 3 and 120 characters."
  }

  if (!isValidProductSlug(input.slug)) {
    errors.slug = "The address must be 4 to 80 characters: lowercase letters, numbers and hyphens."
  }

  if (input.categorySlug === "") {
    errors.category = "Choose a category."
  }

  const shortDescription = input.shortDescription.trim()

  if (shortDescription.length < 10 || shortDescription.length > 200) {
    errors.shortDescription = "The short description must be between 10 and 200 characters."
  }

  const priceKobo = nairaToKobo(input.priceNaira)

  if (priceKobo === null || priceKobo < MIN_PRICE_KOBO || priceKobo > MAX_PRICE_KOBO) {
    errors.price = "Enter a price of at least ₦100 and at most ₦10,000,000."
  }

  const commissionBps = percentToBps(input.commissionPercent)

  if (commissionBps === null) {
    errors.commission = "Enter a whole percentage between 5 and 80."
  }

  return { errors, priceKobo, commissionBps }
}

export function NewProductForm({ categories }: { categories: readonly ProductCategory[] }) {
  const router = useRouter()

  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [categorySlug, setCategorySlug] = useState("")
  const [shortDescription, setShortDescription] = useState("")
  const [priceNaira, setPriceNaira] = useState("")
  const [commissionPercent, setCommissionPercent] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function onTitleChange(value: string): void {
    setTitle(value)

    if (!slugEdited) {
      setSlug(slugify(value))
    }
  }

  async function submit(): Promise<void> {
    const checked = validate({ title, slug, categorySlug, shortDescription, priceNaira, commissionPercent })

    setErrors(checked.errors)
    setFormError(null)

    if (Object.keys(checked.errors).length > 0 || checked.priceKobo === null || checked.commissionBps === null) {
      return
    }

    setSubmitting(true)

    try {
      const result = await createProductDraftAction({
        fields: {
          title: title.trim(),
          slug,
          categorySlug,
          shortDescription: shortDescription.trim(),
          priceKobo: checked.priceKobo,
          commissionBps: checked.commissionBps,
        },
      })

      if (result.ok) {
        router.push(`/products/${result.productId}`)
        return
      }

      const split = splitActionError(result.error)

      if (split.field === null) {
        setFormError(split.message)
      } else {
        setErrors({ [split.field]: split.message })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="max-w-xl space-y-5"
    >
      {formError === null ? null : (
        <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <FormField
        id="product-title"
        label="Title"
        required
        error={errors.title ?? null}
        hint="What the product is called in the marketplace."
      >
        <input
          id="product-title"
          name="title"
          type="text"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          aria-describedby={describedBy("product-title")}
          aria-invalid={errors.title !== undefined}
          maxLength={120}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>

      <FormField
        id="product-slug"
        label="Store address"
        required
        error={errors.slug ?? null}
        hint="Made from the title. You can change it, and it cannot change once the product is published."
      >
        <input
          id="product-slug"
          name="slug"
          type="text"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true)
            setSlug(event.target.value)
          }}
          aria-describedby={describedBy("product-slug")}
          aria-invalid={errors.slug !== undefined}
          maxLength={80}
          className="h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>

      <FormField id="product-category" label="Category" required error={errors.category ?? null}>
        <select
          id="product-category"
          name="category"
          value={categorySlug}
          onChange={(event) => setCategorySlug(event.target.value)}
          aria-describedby={describedBy("product-category")}
          aria-invalid={errors.category !== undefined}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          <option value="">Choose a category</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        id="product-short-description"
        label="Short description"
        required
        error={errors.shortDescription ?? null}
        hint={`${shortDescription.trim().length} of 200 characters. One or two lines for the marketplace card.`}
      >
        <textarea
          id="product-short-description"
          name="shortDescription"
          value={shortDescription}
          onChange={(event) => setShortDescription(event.target.value)}
          aria-describedby={describedBy("product-short-description")}
          aria-invalid={errors.shortDescription !== undefined}
          maxLength={200}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="product-price"
          label="Price in naira"
          required
          error={errors.price ?? null}
          hint="₦100 minimum."
        >
          <input
            id="product-price"
            name="price"
            type="text"
            inputMode="decimal"
            value={priceNaira}
            onChange={(event) => setPriceNaira(event.target.value)}
            aria-describedby={describedBy("product-price")}
            aria-invalid={errors.price !== undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </FormField>

        <FormField
          id="product-commission"
          label="Affiliate commission, percent"
          required
          error={errors.commission ?? null}
          hint="A whole number from 5 to 80."
        >
          <input
            id="product-commission"
            name="commission"
            type="text"
            inputMode="numeric"
            value={commissionPercent}
            onChange={(event) => setCommissionPercent(event.target.value)}
            aria-describedby={describedBy("product-commission")}
            aria-invalid={errors.commission !== undefined}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create draft"}
        </button>
        <Link
          href="/products"
          className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
