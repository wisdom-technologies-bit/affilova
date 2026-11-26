// The building blocks every template is made of.
//
// A template imports from here, never from the individual files, so the set is
// visible in one place: a layout, a heading, a paragraph, one button, a quiet
// box, a summary, a code and a footnote.

export { Code } from "@/emails/components/code"
export {
  EMAIL_LOGO_ALT,
  EMAIL_LOGO_PATH,
  EMAIL_LOGO_WIDTH,
  EmailLayout,
  type EmailLayoutProps,
} from "@/emails/components/email-layout"
export { Heading, type HeadingProps } from "@/emails/components/heading"
export { InfoBox, type InfoBoxProps, type InfoBoxTone } from "@/emails/components/info-box"
export { OrderSummary, type OrderSummaryProps, type OrderSummaryRow } from "@/emails/components/order-summary"
export { Paragraph, type ParagraphProps } from "@/emails/components/paragraph"
export { PrimaryButton, type PrimaryButtonProps } from "@/emails/components/primary-button"
export { SecondaryText, type SecondaryTextProps } from "@/emails/components/secondary-text"
