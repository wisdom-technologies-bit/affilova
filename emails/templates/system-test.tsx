import { EmailLayout, InfoBox, OrderSummary, Paragraph } from "@/emails/components"
import type { BrandingUrls } from "@/emails/types"

// Staff: the test message behind the Security page button.
//
// It exists to prove the whole path: the deployment can reach Brevo, the key is
// accepted and the sender is one Brevo will send from. So it says that, and it
// says what it did not do. It is a real template rather than a hand-written
// string, so the thing being tested is the same pipeline every other message
// uses, footer and all.

export interface SystemTestProps {
  branding: BrandingUrls
  /** What ran: "the email sender" or "the scanner and the email sender". */
  scope: string
}

export const SYSTEM_TEST_SUBJECT = "Affilova email test"

export function systemTestSubject(): string {
  return SYSTEM_TEST_SUBJECT
}

export function SystemTest(props: SystemTestProps) {
  return (
    <EmailLayout
      branding={props.branding}
      heading="This is a test message"
      previewText="A test from the Affilova admin console"
      reason="You are receiving this because an administrator asked for a test from the Affilova admin console."
    >
      <Paragraph>
        This message was sent from the Affilova admin console to check {props.scope}.
      </Paragraph>

      <OrderSummary
        rows={[
          { label: "Sent from", value: "The Affilova admin console" },
          { label: "Sent to", value: "The signed-in administrator" },
        ]}
      />

      <InfoBox tone="success" title="What this proves">
        If you are reading it, the deployment can reach Brevo, the API key is accepted and the sender
        address is one Brevo will send from.
      </InfoBox>

      <Paragraph>Nothing was created and nothing was charged.</Paragraph>
    </EmailLayout>
  )
}

export const systemTestSample: SystemTestProps = {
  branding: { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" },
  scope: "the email sender",
}
