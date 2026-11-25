// The parts of the withdrawal notice job that need no server-only import, so
// the webhook and the payout service can name the job without loading the
// handler.

export const WITHDRAWAL_NOTICE_JOB = "withdrawal_notice"

export type NoticeStatusKey = "paid" | "failed" | "reversed" | "rejected"

export function isNoticeStatus(value: string): value is NoticeStatusKey {
  return value === "paid" || value === "failed" || value === "reversed" || value === "rejected"
}

/** One live job per withdrawal (id or reference) and outcome. */
export function withdrawalNoticeDedupeKey(subject: string, status: NoticeStatusKey): string {
  return `${WITHDRAWAL_NOTICE_JOB}:${subject}:${status}`
}
