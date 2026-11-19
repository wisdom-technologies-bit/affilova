import {
  markRefundFailed,
  markRefundSubmitted,
  readOrderForRefund,
  readRefundRequest,
} from "@/lib/commerce/db"
import { REFUND_SUBMIT_JOB, runRefundSubmitJob } from "@/lib/commerce/refund-submit"
import { logger } from "@/lib/logger"
import { createRefund } from "@/lib/paystack/client"
import {
  runQuarantineFileJob,
  runScanFileJob,
  runScanSweepJob,
} from "@/lib/scanning/jobs"

import { sendEmail } from "@/lib/email/brevo"
import { readOrderSummary } from "@/lib/commerce/order-summary"
import { createAccessToken } from "@/lib/commerce/access-token"
import { appUrl } from "@/lib/identity/app-urls"

import {
  ORDER_PAID_JOB,
  REFUND_NOTICE_JOB,
  emailLog,
  runOrderPaidJob,
  runRefundNoticeJob,
} from "./order-email"
import { runStorageCleanupJob } from "./storage-cleanup"
import type { Job } from "./types"

/** A unit of work for one job type. Throwing means the job failed. */
export type JobHandler = (job: Job) => Promise<void>

// Handlers register themselves at module load, so importing this file (directly,
// from the cron route) is what makes the handlers available.
const handlers = new Map<string, JobHandler>()

export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler)
}

export function getHandler(type: string): JobHandler | undefined {
  return handlers.get(type)
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()]
}

// Placeholder job type. It exists so the queue can be exercised end to end
// before any real work is implemented.
const noopHandler: JobHandler = async () => {
  // Intentionally empty.
}

registerHandler("noop", noopHandler)

// Clear file reservations that never became uploads: abandoned multipart parts
// in the bucket and the rows that hold them.
registerHandler("storage_cleanup", async () => {
  await runStorageCleanupJob()
})

// Ask the scanner about one file, and record that the request was accepted.
registerHandler("scan_file", async (job) => {
  await runScanFileJob(job.payload)
})

// Queue a scan for every file that is due: never scanned, failed, stuck in
// 'queued' for too long, or clean but old enough for the weekly rescan.
registerHandler("scan_sweep", async () => {
  await runScanSweepJob()
})

// Copy an infected object into quarantine, then delete the original.
registerHandler("quarantine_file", async (job) => {
  await runQuarantineFileJob(job.payload)
})

// Submit an approved refund to Paystack. The ledger is not touched here: the
// reversal is posted by the refund.processed webhook. A retryable failure throws
// so the queue tries again; a terminal one is recorded on the request.
registerHandler(REFUND_SUBMIT_JOB, async (job) => {
  await runRefundSubmitJob(job.payload, {
    readRequest: readRefundRequest,
    readOrder: readOrderForRefund,
    createRefund,
    markSubmitted: markRefundSubmitted,
    markFailed: markRefundFailed,
    logWarn: (event, fields) => logger.warn(event, fields),
  })
})

// Email the buyer, the vendor and (when there is one) the affiliate after a
// payment. Every send is claimed in public.email_log first, so a retry that
// follows a partial failure sends only what is missing.
// Built per job, not at import: the branding URLs read the environment, and a
// module that cannot load without it would break every route that imports this
// file.
function orderEmailDeps() {
  return {
    readOrder: readOrderSummary,
    createToken: createAccessToken,
    send: sendEmail,
    log: emailLog,
    branding: {
      siteUrl: appUrl("public", "/"),
      contactUrl: appUrl("public", "/contact"),
    },
  }
}

registerHandler(ORDER_PAID_JOB, async (job) => {
  await runOrderPaidJob(job.payload, orderEmailDeps())
})

// Tell the buyer their money was returned. Enqueued by the refund flow; the
// handler is the same shape as order_paid, with its own dedupe kind.
registerHandler(REFUND_NOTICE_JOB, async (job) => {
  await runRefundNoticeJob(job.payload, orderEmailDeps())
})
