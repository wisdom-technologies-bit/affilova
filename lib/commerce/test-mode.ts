import { getServerEnv } from "@/lib/env"

// Paystack test mode, decided by the key the deployment holds.
//
// Nothing else in the app reads the key prefix: the checkout still goes through
// the same code path, so a test-mode deployment exercises exactly what a live
// one does, minus the money. The banner exists so nobody mistakes a test charge
// for a real sale.

/** The prefix of a Paystack test secret key. */
export const PAYSTACK_TEST_PREFIX = "sk_test_"

/** The sentence shown to a buyer while the deployment is in test mode. */
export const TEST_MODE_BANNER = "Test mode: no real money is charged"

/**
 * True when the configured Paystack secret key is a test key.
 *
 * A missing key, or a server environment that cannot be parsed, answers false:
 * an unconfigured deployment is not "in test mode", it simply cannot take money.
 */
export function isPaystackTestMode(): boolean {
  try {
    const key = getServerEnv().PAYSTACK_SECRET_KEY

    return typeof key === "string" && key.startsWith(PAYSTACK_TEST_PREFIX)
  } catch {
    return false
  }
}

/** The same decision, on a value handed in: used by tests and by callers that
 * already read the environment. */
export function secretKeyIsTest(secretKey: string | undefined | null): boolean {
  return typeof secretKey === "string" && secretKey.trim().startsWith(PAYSTACK_TEST_PREFIX)
}
