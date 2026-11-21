import type { PolicyKey } from "@/lib/site-config"

export type InlineSegment =
  | string
  | { readonly term: string }
  | { readonly link: { readonly label: string; readonly href: string } }

export type RichText = string | readonly InlineSegment[]

export type LegalBlock =
  | { readonly type: "paragraph"; readonly text: RichText }
  | { readonly type: "list"; readonly items: readonly RichText[] }
  | { readonly type: "clauses"; readonly items: readonly RichText[] }

export interface LegalSection {
  readonly id: string
  readonly title: string
  readonly blocks: readonly LegalBlock[]
}

export interface LegalDocumentData {
  readonly key: PolicyKey
  readonly slug: string
  readonly href: string
  readonly title: string
  readonly description: string
  readonly version: string
  readonly effectiveDate: string
  readonly summary: readonly [string, string, string, string, string]
  readonly sections: readonly LegalSection[]
}
