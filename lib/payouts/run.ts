import "server-only"

import { logger } from "@/lib/logger"
import { getPaystackTransfers } from "@/lib/paystack/transfers"

import * as store from "./db"
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
  })
}
