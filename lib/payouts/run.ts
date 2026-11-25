import "server-only"

import { enqueueJob } from "@/lib/jobs/queue"
import { logger } from "@/lib/logger"
import { getPaystackTransfers } from "@/lib/paystack/transfers"

import * as store from "./db"
import { enqueueWithdrawalNotice } from "./notices"
import { createPayoutService, type PayoutService } from "./service"

// The real wiring: the SQL wrappers, the Paystack client and the logger.
//
// Built on each call rather than at import, so a deployment without a Paystack
// key still builds and every other route keeps working.

export function getPayoutService(): PayoutService {
  return createPayoutService({
    transfers: getPaystackTransfers(),
    store,
    log: logger,
    onSettled: async ({ reference, status, applied }) => {
      // Only a result this call applied is news; a repeat tells nobody twice.
      if (applied) {
        await enqueueWithdrawalNotice(enqueueJob, { reference }, status, logger)
      }
    },
  })
}
