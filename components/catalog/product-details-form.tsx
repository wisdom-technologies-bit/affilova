"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { describedBy, FormField } from "@/components/forms/form-field"
import { useUnsavedChanges } from "@/components/catalog/use-unsaved-changes"
import { updateProductAction } from "@/lib/catalog/actions/vendor"
import type { ProductDetail } from "@/lib/catalog/action-types"
import type { ProductCategory } from "@/lib/catalog/categories"
import { splitActionError, type ProductFieldName } from "@/lib/catalog/field-errors"
import { isValidProductSlug } from "@/lib/catalog/slug"

// The words and the filing of a product: title, address, category, the two
// descriptions. The address locks once the product is published, because it is
// the link affiliates and customers already hold.

const MAX_SHORT = 200
const MAX_DESCRIPTION = 10_000

type Errors = Partial<Record<ProductFieldName, string>>

export function ProductDetailsForm({
  product,
  categories,
}: {
  product: ProductDetail
  categories: readonly ProductCategory[]
}) {
  const router = useRouter()

  const initial = {
    title: product.title,
    slug: product.slug,
    categorySlug: categories.find((category) => category.id === product.categoryId)?.slug ?? "",
    shortDescription: product.shortDescription,
    description: product.description,
  }

  const [values, setValues] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const slugLocked = product.publishedAt !== null
  const dirty =
    values.title !== saved.title ||
    values.slug !== saved.slug ||
    values.categorySlug !== saved.categorySlug ||
    values.shortDescription !== saved.shortDescription ||
    values.description !== saved.description

  useUnsavedChanges(dirty)

  function update(next: Partial<typeof values>): void {
    setValues((current) => ({ ...current, ...next }))
    setNotice(null)
  }

  async function save(): Promise<void> {
    const found: Errors = {}
    const title = values.title.trim()
    const shortDescription = values.shortDescription.trim()

    if (title.length < 3 || title.length > 120) {
      found.title = "The title must be between 3 and 120 characters."
    }

    if (!slugLocked && !isValidProductSlug(values.slug)) {
      found.slug = "The address must be 4 to 80 characters: lowercase letters, numbers and hyphens."
    }

    if (values.categorySlug === "") {
      found.category = "Choose a category."
    }

    if (shortDescription.length < 10 || shortDescription.length > MAX_SHORT) {
      found.shortDescription = "The short description must be between 10 and 200 characters."
    }

    if (values.description.length > MAX_DESCRIPTION) {
      found.description = "The description is too long."
    }

    setErrors(found)
    setFormError(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setSaving(true)

    try {
      const result = await updateProductAction({
        productId: product.id,
        fields: {
          title,
          categorySlug: values.categorySlug,
          shortDescription,
          description: values.description,
          ...(slugLocked ? {} : { slug: values.slug }),
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

      const next = { ...values, title, shortDescription }

      setValues(next)
      setSaved(next)
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

      <FormField id="details-title" label="Title" required error={errors.title ?? null}>
        <input
          id="details-title"
          type="text"
          value={values.title}
          onChange={(event) => update({ title: event.target.value })}
          aria-describedby={describedBy("details-title")}
          aria-invalid={errors.title !== undefined}
          maxLength={120}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>

      <FormField
        id="details-slug"
        label="Store address"
        required
        error={errors.slug ?? null}
        hint={
          slugLocked
            ? "The address cannot change once the product is published."
            : "Lowercase letters, numbers and hyphens. It cannot change once the product is published."
        }
      >
        <input
          id="details-slug"
          type="text"
          value={values.slug}
          onChange={(event) => update({ slug: event.target.value })}
          disabled={slugLocked}
          readOnly={slugLocked}
          aria-describedby={describedBy("details-slug")}
          aria-invalid={errors.slug !== undefined}
          maxLength={80}
          className="h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:bg-muted"
        />
      </FormField>

      <FormField id="details-category" label="Category" required error={errors.category ?? null}>
        <select
          id="details-category"
          value={values.categorySlug}
          onChange={(event) => update({ categorySlug: event.target.value })}
          aria-describedby={describedBy("details-category")}
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
        id="details-short-description"
        label="Short description"
        required
        error={errors.shortDescription ?? null}
        hint={`${values.shortDescription.trim().length} of ${MAX_SHORT} characters.`}
      >
        <textarea
          id="details-short-description"
          value={values.shortDescription}
          onChange={(event) => update({ shortDescription: event.target.value })}
          aria-describedby={describedBy("details-short-description")}
          aria-invalid={errors.shortDescription !== undefined}
          maxLength={MAX_SHORT}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>

      <FormField
        id="details-description"
        label="Description"
        error={errors.description ?? null}
        hint={`${values.description.length} of ${MAX_DESCRIPTION.toLocaleString("en-NG")} characters. Line breaks are kept.`}
      >
        <textarea
          id="details-description"
          value={values.description}
          onChange={(event) => update({ description: event.target.value })}
          aria-describedby={describedBy("details-description")}
          aria-invalid={errors.description !== undefined}
          maxLength={MAX_DESCRIPTION}
          rows={12}
          className="w-full whitespace-pre-wrap rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save details"}
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
