// Shapes shared by the payout actions, the pages and the components.
//
// No server-only import here: client components import these types and the
// constants. Money is bigint kobo everywhere. Nothing in these types can hold a
// full account number, a recipient code, a step-up code or a hash.

export interface PayoutAccountView {
  bankName: string
  accountLast4: string
  accountName: string
  /** Set while the 72 hour freeze after a bank change is running. */
  frozenUntil: string | null
}

export interface PayoutSettingsView {
  minWithdrawalKobo: bigint
  feeBps: number
  feeMinKobo: bigint
  feeCapKobo: bigint
  holdDays: number
}

export interface ScreenWithdrawal {
  id: string
  kind: "auto" | "manual"
  status: string
  grossKobo: bigint
  feeKobo: bigint
  netKobo: bigint
  requestedAt: string
  paidAt: string | null
  /** Only ever the rejection reason written for the user. */
  reason: string | null
}

export interface PayoutScreenData {
  account: PayoutAccountView | null
  autoPayout: boolean
  availableKobo: bigint
  pendingKobo: bigint
  totalKobo: bigint
  /** The Lagos calendar day, YYYY-MM-DD. */
  today: string
  nextPayoutDay: string | null
  todayIsPayoutDay: boolean
  blackoutReason: string | null
  settings: PayoutSettingsView
  withdrawals: readonly ScreenWithdrawal[]
}

export interface WithdrawalPreviewView {
  allowed: boolean
  reasons: readonly string[]
  grossKobo: bigint
  feeKobo: bigint
  netKobo: bigint
  availableKobo: bigint
  nextPayoutDay: string | null
  needsApproval: boolean
}

export interface BankOption {
  name: string
  code: string
}

export type AdminQueueTab = "needs_approval" | "processing" | "paid" | "closed"

export const ADMIN_QUEUE_TABS: readonly { value: AdminQueueTab; label: string }[] = [
  { value: "needs_approval", label: "Needs approval" },
  { value: "processing", label: "Approved and processing" },
  { value: "paid", label: "Paid" },
  { value: "closed", label: "Failed or rejected" },
]

export interface AdminQueueCursor {
  requestedAt: string
  id: string
}

export interface AdminQueueRow {
  id: string
  userId: string
  kind: "auto" | "manual"
  status: string
  grossKobo: bigint
  feeKobo: bigint
  netKobo: bigint
  requestedAt: string
  paidAt: string | null
  failureReason: string | null
  bankName: string
  accountLast4: string
  accountName: string
  isFirst: boolean
  hasRiskFlag: boolean
  approvals: number
  needsTwoApprovers: boolean
  needsSecondApprover: boolean
  firstApprover: string | null
}

export interface AdminQueuePage {
  rows: readonly AdminQueueRow[]
  nextCursor: AdminQueueCursor | null
}

export interface BlackoutDay {
  day: string
  reason: string
}

/** The only settings the payout screens can change. The SQL enforces the same list. */
export const PAYOUT_SETTING_KEYS = [
  "withdrawal_fee_bps",
  "withdrawal_fee_min_kobo",
  "withdrawal_fee_cap_kobo",
  "min_withdrawal_kobo",
  "payout_auto_approve_max_kobo",
  "payout_dual_approval_kobo",
  "payout_first_requires_approval",
  "withdrawal_daily_limit_kobo",
  "platform_fee_bps",
  "commission_hold_days",
  "auto_payout_default",
] as const

export type PayoutSettingKey = (typeof PAYOUT_SETTING_KEYS)[number]

export interface PayoutSettingChange {
  key: string
  oldValue: boolean | bigint | null
  newValue: boolean | bigint | null
  changedBy: string | null
  changedAt: string
}

export interface PayoutSettingsSnapshot {
  values: Readonly<Record<string, boolean | bigint>>
  changes: readonly PayoutSettingChange[]
}
