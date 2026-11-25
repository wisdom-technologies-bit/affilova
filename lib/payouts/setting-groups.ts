import type { PayoutSettingKey } from "./screen-types"

// The settings the admin screen can change, grouped as the form shows them. The
// ranges here are help text only: the database enforces them.

export type SettingKind = "naira" | "percent" | "days" | "switch"

export interface SettingField {
  key: PayoutSettingKey
  label: string
  kind: SettingKind
  help: string
}

export interface SettingGroup {
  id: string
  title: string
  description: string
  fields: readonly SettingField[]
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    id: "fees",
    title: "Withdrawal fee",
    description: "What a withdrawal costs the person withdrawing.",
    fields: [
      { key: "withdrawal_fee_bps", label: "Fee percent", kind: "percent", help: "0% to 10%." },
      { key: "withdrawal_fee_min_kobo", label: "Fee minimum", kind: "naira", help: "In naira. Not above the cap." },
      { key: "withdrawal_fee_cap_kobo", label: "Fee cap", kind: "naira", help: "In naira. Not below the minimum." },
    ],
  },
  {
    id: "limits",
    title: "Limits",
    description: "How much can be withdrawn.",
    fields: [
      { key: "min_withdrawal_kobo", label: "Minimum withdrawal", kind: "naira", help: "In naira." },
      { key: "withdrawal_daily_limit_kobo", label: "Daily limit per person", kind: "naira", help: "In naira." },
    ],
  },
  {
    id: "approval",
    title: "Approval",
    description: "When a person on the team has to approve a withdrawal.",
    fields: [
      {
        key: "payout_auto_approve_max_kobo",
        label: "Approved automatically up to",
        kind: "naira",
        help: "In naira. Above this, one approver is needed.",
      },
      {
        key: "payout_dual_approval_kobo",
        label: "Two approvers from",
        kind: "naira",
        help: "In naira. Not below the automatic limit.",
      },
      {
        key: "payout_first_requires_approval",
        label: "Approve every first withdrawal",
        kind: "switch",
        help: "A person's first withdrawal always waits for approval.",
      },
    ],
  },
  {
    id: "commission",
    title: "Commission and automatic payout",
    description: "Changes to the platform fee apply to future orders only.",
    fields: [
      { key: "platform_fee_bps", label: "Platform fee percent", kind: "percent", help: "0% to 30%. Future orders only." },
      { key: "commission_hold_days", label: "Hold days", kind: "days", help: "0 to 60 days." },
      {
        key: "auto_payout_default",
        label: "Automatic payout is on for new accounts",
        kind: "switch",
        help: "People can still change it for themselves.",
      },
    ],
  },
]
