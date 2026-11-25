import { WITHDRAWAL_NOTICE_JOB, isNoticeStatus, withdrawalNoticeDedupeKey } from "@/lib/jobs/withdrawal-notice-keys"

// Queue the notice email for a withdrawal that just settled. Never throws: a
// queue failure is logged and must not undo or retry the settlement itself.

export type EnqueueFn = (input: {
  type: string
  payload: Record<string, unknown>
  dedupeKey: string
}) => Promise<unknown>

export type NoticeSubject = { withdrawalId: string } | { reference: string }

export async function enqueueWithdrawalNotice(
  enqueue: EnqueueFn,
  subject: NoticeSubject,
  status: string,
  log: { error: (event: string, fields?: Record<string, unknown>) => void },
): Promise<boolean> {
  if (!isNoticeStatus(status)) {
    return false
  }

  const key = "withdrawalId" in subject ? subject.withdrawalId : subject.reference

  try {
    await enqueue({
      type: WITHDRAWAL_NOTICE_JOB,
      payload:
        "withdrawalId" in subject
          ? { withdrawal_id: subject.withdrawalId, status }
          : { reference: subject.reference, status },
      dedupeKey: withdrawalNoticeDedupeKey(key, status),
    })

    return true
  } catch {
    log.error("withdrawal_notice_enqueue_failed", { status })

    return false
  }
}
