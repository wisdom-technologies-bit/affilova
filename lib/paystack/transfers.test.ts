import { afterEach, describe, expect, it, vi } from "vitest"

import { PaystackError } from "./client"
import {
  PAYSTACK_BANK_CACHE_MS,
  createPaystackTransfers,
  type PaystackTransfersOptions,
} from "./transfers"

// Every test drives the client with a fake fetch. Paystack cannot be reached
// from a test or from the sandbox, so nothing here is a live call.

const SECRET = "sk_test_0123456789abcdef0123456789abcdef"
const ACCOUNT_NUMBER = "0123456789"
const RECIPIENT = "RCP_abc123def456"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function makeClient(
  responses: Array<Response | (() => Promise<Response>)>,
  overrides: Partial<PaystackTransfersOptions> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = []

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses.shift()

    if (next === undefined) {
      throw new Error("unexpected fetch call")
    }

    return typeof next === "function" ? await next() : next
  })

  const client = createPaystackTransfers({
    secretKey: SECRET,
    fetch: fetchImpl as unknown as typeof fetch,
    ...overrides,
  })

  return { client, calls, fetchImpl }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("listBanks", () => {
  it("parses the list and asks for Nigeria", async () => {
    const { client, calls } = makeClient([
      jsonResponse({
        status: true,
        data: [
          { name: "Guaranty Trust Bank", code: "058", slug: "gtbank", active: true },
          { name: "Zenith Bank", code: "057", slug: null, active: false },
        ],
      }),
    ])

    const banks = await client.listBanks()

    expect(banks).toEqual([
      { name: "Guaranty Trust Bank", code: "058", slug: "gtbank", active: true },
      { name: "Zenith Bank", code: "057", slug: null, active: false },
    ])
    expect(calls[0]?.url).toContain("/bank?country=nigeria")
    expect(calls[0]?.init.method).toBe("GET")
  })

  it("caches for six hours and refetches after that", async () => {
    let clock = 0

    const { client, fetchImpl } = makeClient(
      [
        jsonResponse({ status: true, data: [{ name: "GTBank", code: "058", active: true }] }),
        jsonResponse({ status: true, data: [{ name: "GTBank", code: "058", active: true }] }),
      ],
      { now: () => clock },
    )

    await client.listBanks()
    await client.listBanks()

    expect(fetchImpl).toHaveBeenCalledTimes(1)

    clock += PAYSTACK_BANK_CACHE_MS + 1
    await client.listBanks()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe("resolveAccount", () => {
  it("sends the account number and bank code and returns the name", async () => {
    const { client, calls } = makeClient([
      jsonResponse({
        status: true,
        data: { account_name: "ADAEZE OKONKWO", account_number: ACCOUNT_NUMBER },
      }),
    ])

    const resolved = await client.resolveAccount({ accountNumber: ACCOUNT_NUMBER, bankCode: "058" })

    expect(resolved).toEqual({ accountName: "ADAEZE OKONKWO", accountNumber: ACCOUNT_NUMBER })
    expect(calls[0]?.url).toContain("/bank/resolve?account_number=0123456789&bank_code=058")
  })

  it("refuses a malformed answer", async () => {
    const { client } = makeClient([jsonResponse({ status: true, data: { account_name: 7 } })])

    await expect(
      client.resolveAccount({ accountNumber: ACCOUNT_NUMBER, bankCode: "058" }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })
})

describe("createRecipient", () => {
  it("posts a nuban recipient in naira", async () => {
    const { client, calls } = makeClient([
      jsonResponse({ status: true, data: { recipient_code: RECIPIENT, name: "ADAEZE OKONKWO" } }),
    ])

    const created = await client.createRecipient({
      name: "ADAEZE OKONKWO",
      accountNumber: ACCOUNT_NUMBER,
      bankCode: "058",
    })

    expect(created.recipientCode).toBe(RECIPIENT)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      type: "nuban",
      name: "ADAEZE OKONKWO",
      account_number: ACCOUNT_NUMBER,
      bank_code: "058",
      currency: "NGN",
    })
  })
})

describe("getBalance", () => {
  it("returns each currency balance in kobo", async () => {
    const { client } = makeClient([
      jsonResponse({
        status: true,
        data: [
          { currency: "NGN", balance: 12500000 },
          { currency: "GHS", balance: 500 },
        ],
      }),
    ])

    await expect(client.getBalance()).resolves.toEqual([
      { currency: "NGN", balanceKobo: 12500000 },
      { currency: "GHS", balanceKobo: 500 },
    ])
  })
})

describe("initiateTransfer", () => {
  const input = {
    amountKobo: 9800000,
    recipientCode: RECIPIENT,
    reference: "wd_abcdefghijklmnopqrstuvwx",
    reason: "Affilova payout",
  }

  it("sends the documented body and reports the fee", async () => {
    const { client, calls } = makeClient([
      jsonResponse({
        status: true,
        data: {
          id: 424242,
          transfer_code: "TRF_abc",
          reference: input.reference,
          status: "success",
          amount: 9800000,
          fee_charged: 1000,
        },
      }),
    ])

    const transfer = await client.initiateTransfer(input)

    expect(transfer).toMatchObject({
      transferCode: "TRF_abc",
      transferId: BigInt(424242),
      status: "success",
      amountKobo: 9800000,
      feeKobo: 1000,
      alreadySubmitted: false,
    })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      source: "balance",
      amount: 9800000,
      recipient: RECIPIENT,
      reference: input.reference,
      reason: "Affilova payout",
    })
    expect(calls).toHaveLength(1)
  })

  it("never retries, even when Paystack is unavailable", async () => {
    const { client, fetchImpl } = makeClient([jsonResponse({ status: false }, 500)])

    await expect(client.initiateTransfer(input)).rejects.toMatchObject({
      code: "server_error",
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("never retries a timeout", async () => {
    const { client, fetchImpl } = makeClient([
      async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" })
      },
    ])

    await expect(client.initiateTransfer(input)).rejects.toMatchObject({ code: "timeout" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("treats a duplicate reference as already submitted", async () => {
    const { client } = makeClient([
      jsonResponse({ status: false, message: "Duplicate reference: transfer already exists" }, 400),
    ])

    const transfer = await client.initiateTransfer(input)

    expect(transfer.alreadySubmitted).toBe(true)
    expect(transfer.reference).toBe(input.reference)
  })

  it("does not treat another 400 as a duplicate", async () => {
    const { client } = makeClient([
      jsonResponse({ status: false, message: "Recipient not found" }, 400),
    ])

    await expect(client.initiateTransfer(input)).rejects.toMatchObject({
      code: "bad_request",
      retryable: false,
    })
  })

  it("refuses a non-integer amount before calling Paystack", async () => {
    const { client, fetchImpl } = makeClient([])

    await expect(client.initiateTransfer({ ...input, amountKobo: 12.5 })).rejects.toBeInstanceOf(
      PaystackError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("refuses a body that is not a transfer", async () => {
    const { client } = makeClient([jsonResponse({ status: true, data: { nope: true } })])

    await expect(client.initiateTransfer(input)).rejects.toMatchObject({ code: "invalid_response" })
  })
})

describe("getTransferByReference", () => {
  it("escapes the reference into the path", async () => {
    const { client, calls } = makeClient([
      jsonResponse({
        status: true,
        data: {
          transfer_code: "TRF_abc",
          reference: "wd_abc",
          status: "pending",
          amount: 500000,
          fee_charged: 1000,
        },
      }),
    ])

    const transfer = await client.getTransferByReference("wd_abc")

    expect(transfer.status).toBe("pending")
    expect(transfer.feeKobo).toBe(1000)
    expect(calls[0]?.url).toContain("/transfer/verify/wd_abc")
  })

  it("maps 404 to not_found", async () => {
    const { client } = makeClient([jsonResponse({ status: false }, 404)])

    await expect(client.getTransferByReference("wd_missing")).rejects.toMatchObject({
      code: "not_found",
    })
  })
})

describe("what never leaks", () => {
  it("never puts the key, the account number or the recipient code in an error", async () => {
    const { client } = makeClient([jsonResponse({ status: true, data: { wrong: "shape" } })])

    const error = await client
      .createRecipient({ name: "A", accountNumber: ACCOUNT_NUMBER, bankCode: "058" })
      .catch((caught: unknown) => caught)

    const text = `${String(error)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`

    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(ACCOUNT_NUMBER)
    expect(text).not.toContain(RECIPIENT)
  })

  it("keeps the key in the Authorization header only", async () => {
    const { client, calls } = makeClient([
      jsonResponse({ status: true, data: [{ currency: "NGN", balance: 1 }] }),
    ])

    await client.getBalance()

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(calls[0]?.url).not.toContain(SECRET)
  })
})
