import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The three VAT settings the screens need to explain themselves.
//
// Read through the service client because the settings table is not readable by
// every role, and only the three keys below are ever selected.

export interface VatSettings {
  enabled: boolean
  rateBps: number
  /** platform_fee, product_price or both. */
  basis: string
  pricesIncludeVat: boolean
}

const DEFAULTS: VatSettings = {
  enabled: false,
  rateBps: 750,
  basis: "platform_fee",
  pricesIncludeVat: false,
}

export async function getVatSettings(): Promise<VatSettings> {
  const { data, error } = await getSupabaseAdminClient()
    .from("settings")
    .select("key, value")
    .in("key", ["vat_enabled", "vat_rate_bps", "vat_applies_to", "prices_include_vat"])

  if (error !== null) {
    return DEFAULTS
  }

  const values = new Map<string, unknown>()

  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    values.set(row.key, row.value)
  }

  const rate = values.get("vat_rate_bps")
  const basis = values.get("vat_applies_to")

  return {
    enabled: values.get("vat_enabled") === true,
    rateBps: typeof rate === "number" && Number.isInteger(rate) ? rate : DEFAULTS.rateBps,
    basis: typeof basis === "string" && basis !== "" ? basis : DEFAULTS.basis,
    pricesIncludeVat: values.get("prices_include_vat") === true,
  }
}
