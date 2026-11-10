"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

interface SquadPaymentProps {
  email: string
  amount: number // in Naira
  onSuccess: (reference: string) => void
  onClose: () => void
  onError: (error: string) => void
  metadata?: Record<string, any>
  disabled?: boolean
  children?: React.ReactNode
}

declare global {
  interface Window {
    squad: any
  }
}

export function SquadPayment({
  email,
  amount,
  onSuccess,
  onClose,
  onError,
  metadata = {},
  disabled = false,
  children,
}: SquadPaymentProps) {
  const [loading, setLoading] = useState(false)
  const [squadLoaded, setSquadLoaded] = useState(false)

  useEffect(() => {
    // Load Squad script
    const script = document.createElement("script")
    script.src = "https://checkout.squadco.com/widget/squad.min.js"
    script.async = true
    script.onload = () => setSquadLoaded(true)
    script.onerror = () => onError("Failed to load payment system")
    document.body.appendChild(script)

    return () => {
      document.body.removeChild(script)
    }
  }, [onError])

  const handlePayment = async () => {
    if (!squadLoaded || !window.squad) {
      onError("Payment system not loaded")
      return
    }

    setLoading(true)

    try {
      // Get Squad public key from API
      const response = await fetch("/api/payments/squad/config")
      const { publicKey } = await response.json()

      const squadInstance = new window.squad({
        onClose: () => {
          setLoading(false)
          onClose()
        },
        onLoad: () => {
          console.log("Squad widget loaded successfully")
        },
        onSuccess: (data: any) => {
          setLoading(false)
          onSuccess(data.transaction_ref || data.reference)
        },
        onError: (error: any) => {
          setLoading(false)
          onError(error.message || "Payment failed")
        },
        key: publicKey,
        email: email,
        amount: amount * 100, // Convert to kobo
        currency_code: "NGN",
        metadata: {
          ...metadata,
          callback_url: `${window.location.origin}/api/payments/squad/callback`,
        },
      })

      squadInstance.setup()
      squadInstance.open()
    } catch (error) {
      setLoading(false)
      onError(error instanceof Error ? error.message : "Payment initialization failed")
    }
  }

  return (
    <Button onClick={handlePayment} disabled={disabled || loading || !squadLoaded} className="w-full">
      {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children || `Pay ₦${amount.toLocaleString()}`}
    </Button>
  )
}
