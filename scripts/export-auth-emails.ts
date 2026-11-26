import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"

import { renderEmailHtml } from "@/emails/render"
import { AUTH_EMAIL_FILES, authSampleBranding, authTemplateVariablesSample } from "@/emails/templates/auth"

// Writes the four Supabase Auth templates as files an owner can paste in.
//
// Supabase sends these messages, not this application, so they cannot be rendered
// with real values: they are rendered with Supabase's own template variables
// ({{ .SiteURL }}, {{ .TokenHash }}, {{ .Email }}, {{ .NewEmail }}) and the
// result is pasted into Authentication, Emails, Templates. The files are
// committed so nobody has to run anything to use them.
//
// Run with `pnpm emails:export`, which executes scripts/export-auth-emails.test.ts:
// this repository has no separate TypeScript runner, and vitest already compiles
// the JSX and resolves the "@/" alias, so the export runs through the same tool
// the tests use. Nothing here is a test; the wrapper only starts it.

/** Where the files go: committed, and referenced by docs/auth-setup.md. */
export const AUTH_EMAIL_OUTPUT_DIR = join(process.cwd(), "emails", "dist")

export interface ExportedAuthEmail {
  /** The file name under emails/dist. */
  file: string
  /** The Supabase dashboard template it replaces. */
  template: string
  /** The subject line to type into the dashboard. */
  subject: string
  bytes: number
}

/**
 * Render and write the four files.
 *
 * Throws on a write error, on purpose: an export that silently wrote nothing
 * would leave the dashboard holding the old templates while the repository said
 * otherwise.
 */
export function exportAuthEmails(outputDir: string = AUTH_EMAIL_OUTPUT_DIR): readonly ExportedAuthEmail[] {
  mkdirSync(outputDir, { recursive: true })

  return AUTH_EMAIL_FILES.map((entry) => {
    const html = renderEmailHtml(
      createElement(entry.component, { ...authTemplateVariablesSample, branding: authSampleBranding }),
    )

    writeFileSync(join(outputDir, entry.file), `${html}\n`, "utf8")

    return {
      file: entry.file,
      template: entry.template,
      subject: entry.subject,
      bytes: Buffer.byteLength(html, "utf8"),
    }
  })
}
