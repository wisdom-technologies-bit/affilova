import { EmailLayout, InfoBox, OrderSummary, Paragraph, PrimaryButton } from "@/emails/components"
import type { BrandingUrls } from "@/emails/types"
import { formatNaira } from "@/lib/catalog/money"

// Staff: the VAT return reminder.
//
// Two states, one template. It goes to finance and admin accounts only, once per
// month per reminder, and it says so: a message that arrives without an
// explanation is a message somebody reports as spam.

export type VatReminderKind = "due_soon" | "overdue"

export interface VatReminderProps {
  /** The month the return is for, already written for a person: "September 2026". */
  periodLabel: string
  /** The day it is due, already written in Lagos time. */
  dueDate: string
  netPayableKobo: number | bigint
  reminder: VatReminderKind
  /** The absolute address of the VAT screen on the admin host. */
  vatUrl: string
  branding: BrandingUrls
}

export function vatReminderSubject(props: Pick<VatReminderProps, "periodLabel" | "dueDate" | "reminder">): string {
  return props.reminder === "overdue"
    ? `VAT for ${props.periodLabel} is overdue`
    : `VAT for ${props.periodLabel} is due on ${props.dueDate}`
}

export function VatReminder(props: VatReminderProps) {
  const overdue = props.reminder === "overdue"

  return (
    <EmailLayout
      branding={props.branding}
      heading={overdue ? "A VAT return is overdue" : "A VAT return is due soon"}
      previewText={`${props.periodLabel}: ${formatNaira(props.netPayableKobo)} due ${props.dueDate}`}
      reason="You are receiving this because your account has the finance or admin role."
    >
      <Paragraph>
        The VAT return for <strong>{props.periodLabel}</strong> is due on{" "}
        <strong>{props.dueDate}</strong>.
      </Paragraph>

      <OrderSummary
        rows={[
          { label: "Period", value: props.periodLabel },
          { label: "Due date", value: props.dueDate },
          { label: "Net payable", value: formatNaira(props.netPayableKobo) },
        ]}
      />

      <InfoBox tone={overdue ? "danger" : "warning"} title={overdue ? "Overdue" : "Due soon"}>
        {overdue
          ? "The due date has passed. File and pay as soon as you can, then record the payment reference on the VAT screen."
          : "Export the month from the VAT screen, file it with the tax authority, pay, then record the payment reference."}
      </InfoBox>

      <PrimaryButton href={props.vatUrl} label="Open the VAT screen" />

      <Paragraph>
        This reminder is only sent to finance and admin accounts, and only once for each month and
        each reminder.
      </Paragraph>
    </EmailLayout>
  )
}

export const vatReminderSample: VatReminderProps = {
  periodLabel: "September 2026",
  dueDate: "21 October 2026",
  netPayableKobo: 4_875_000,
  reminder: "due_soon",
  vatUrl: "https://admin.affilova.example/vat/2026-09",
  branding: { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" },
}

export const vatReminderOverdueSample: VatReminderProps = {
  ...vatReminderSample,
  reminder: "overdue",
}
