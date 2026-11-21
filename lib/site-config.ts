// Public site configuration read by marketing and legal pages.
//
// Kept in one place so a fee, threshold, hold window or company identity fact
// shown on a public page is never typed twice. Placeholder figures and empty
// LEGAL fields are pending owner confirmation. Change here only.

export interface LegalConfig {
  entityName: string
  registeredAddress: string
  registrationNumber: string
  contactPath: string
  dataProtectionContact: string
  supportEmail: string
}

export const LEGAL: LegalConfig = {
  entityName: "",
  registeredAddress: "",
  registrationNumber: "",
  contactPath: "/contact",
  dataProtectionContact: "",
  supportEmail: "",
}

export type PolicyStatus = "draft" | "final"

export const POLICY_STATUS: PolicyStatus = "draft"

export const POLICY_VERSIONS = {
  terms_of_service: "draft-2026-11-21",
  privacy_policy: "draft-2026-11-21",
  vendor_agreement: "draft-2026-11-21",
  affiliate_agreement: "draft-2026-11-21",
  refund_policy: "draft-2026-11-21",
  acceptable_use: "draft-2026-11-21",
  cookie_policy: "draft-2026-11-21",
  copyright_policy: "draft-2026-11-21",
  earnings_disclaimer: "draft-2026-11-21",
} as const

export type PolicyKey = keyof typeof POLICY_VERSIONS

export const PLATFORM_FEE_PERCENT = 10

export const WITHDRAWAL_FEE = {
  percent: 2,
  minNaira: 50,
  capNaira: 2000,
} as const

export const MIN_WITHDRAWAL_NAIRA = 5000

export const COMMISSION_HOLD_DAYS = 7

export const MIN_REFUND_WINDOW_HOURS = 24

export const COMMISSION_RANGE_PERCENT = {
  min: 5,
  max: 80,
} as const

export const PAYOUT_DAYS_TEXT = "Monday to Friday"

export function formatNairaWhole(amount: number): string {
  const whole = Math.trunc(amount)
  const sign = whole < 0 ? "-" : ""
  const digits = Math.abs(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${sign}₦${digits}`
}

export function legalIdentityLine(
  legal: Pick<LegalConfig, "entityName" | "registeredAddress" | "registrationNumber"> = LEGAL,
): string {
  const entityName = legal.entityName.trim()
  if (entityName === "") {
    return ""
  }

  const registeredAddress = legal.registeredAddress.trim()
  const registrationNumber = legal.registrationNumber.trim()

  let line = `Affilova is operated by ${entityName}`
  if (registeredAddress !== "") {
    line += `, ${registeredAddress}`
  }
  if (registrationNumber !== "") {
    line += ` (registration no. ${registrationNumber})`
  }
  return line
}
