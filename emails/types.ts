// The two types every email in this folder shares.
//
// They live here rather than in lib/email/templates.ts so a template can import
// them without importing the adapters, which import the templates: a cycle that
// would otherwise be one careless import away.

/** The absolute addresses a message needs: the logo, the links, the footer. */
export interface BrandingUrls {
  /** Absolute public site URL, for the logo and the links. */
  siteUrl: string
  /** Absolute contact page URL. */
  contactUrl: string
}

/** The markup and the text of one message, before it has a subject. */
export interface RenderedEmailBody {
  html: string
  text: string
}

/** One rendered message: what the sender posts to Brevo. */
export interface RenderedEmail extends RenderedEmailBody {
  subject: string
}

/** The longest a user-supplied title may be inside a subject line. */
export const SUBJECT_TITLE_MAX = 80
