interface SquadPaymentData {
  email: string
  amount: number // in kobo (multiply by 100)
  currency_code: "NGN" | "USD"
  transaction_ref?: string
  callback_url?: string
  payment_channels?: string[]
  metadata?: Record<string, any>
}

interface SquadVerificationResponse {
  status: number
  success: boolean
  message: string
  data: {
    transaction_ref: string
    transaction_status: string
    gateway_transaction_ref: string
    transaction_amount: number
    transaction_currency_id: string
    created_at: string
    merchant_name: string
    merchant_business_name: string
    plan_code?: string
  }
}

export class SquadService {
  private publicKey: string
  private secretKey: string
  private baseUrl = "https://api-d.squadco.com"

  constructor() {
    this.publicKey = process.env.SQUAD_PUBLIC_KEY || "test_pk_sample-public-key-1"
    this.secretKey = process.env.SQUAD_SECRET_KEY!
  }

  getPublicKey(): string {
    return this.publicKey
  }

  // Single redirect URL for Squad
  getRedirectUrl(): string {
    return `${process.env.NEXT_PUBLIC_APP_URL}/purchase/success`
  }

  getWebhookUrl(): string {
    return `${process.env.NEXT_PUBLIC_APP_URL}/api/payments/squad/webhook`
  }

  async verifyTransaction(transactionRef: string): Promise<SquadVerificationResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/transaction/verify/${transactionRef}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Transaction verification failed")
      }

      return data
    } catch (error) {
      console.error("Squad verification error:", error)
      throw error
    }
  }

  async initializeTransaction(data: SquadPaymentData): Promise<{ transaction_ref: string; checkout_url: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/transaction/initiate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...data,
          callback_url: this.getRedirectUrl(),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || "Transaction initialization failed")
      }

      return result.data
    } catch (error) {
      console.error("Squad initialization error:", error)
      throw error
    }
  }

  async createTransferRecipient(data: {
    account_name: string
    account_number: string
    bank_code: string
  }): Promise<{ recipient_code: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/payout/account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || "Failed to create transfer recipient")
      }

      return result.data
    } catch (error) {
      console.error("Squad recipient creation error:", error)
      throw error
    }
  }

  async initiateTransfer(data: {
    recipient_code: string
    amount: number
    reason: string
    reference?: string
  }): Promise<{ transfer_code: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/payout/transfer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || "Transfer initiation failed")
      }

      return result.data
    } catch (error) {
      console.error("Squad transfer error:", error)
      throw error
    }
  }
}

export const squadService = new SquadService()
