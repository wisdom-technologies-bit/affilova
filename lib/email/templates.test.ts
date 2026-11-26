import { describe, expect, it } from "vitest"

import {
  affiliateCommissionEmail,
  escapeHtml,
  purchaseReceiptEmail,
  refundNoticeEmail,
  vendorSaleEmail,
} from "./templates"

const branding = {
  siteUrl: "https://affilova.example",
  contactUrl: "https://affilova.example/contact",
}

const HOSTILE = `<script>alert("x")</script> O'Brien & "Co"`

describe("email templates", () => {
  it("escapes a hostile product title in the HTML and keeps it readable in the text", () => {
    const email = purchaseReceiptEmail({
      orderNumber: "AFV-2026-000142",
      productTitle: HOSTILE,
      amountKobo: 2_500_000,
      paidAt: "2026-11-18T10:00:00.000Z",
      accessUrl: "https://affilova.example/access/a.b",
      refundWindowHours: 72,
      branding,
    })

    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;script&gt;")
    expect(email.html).toContain("O&#x27;Brien")
    expect(email.html).toContain("&quot;Co&quot;")
    expect(email.text).toContain("<script>alert")
  })

  it("escapes every template's user text", () => {
    const emails = [
      purchaseReceiptEmail({
        orderNumber: HOSTILE,
        productTitle: HOSTILE,
        amountKobo: 100,
        paidAt: "2026-11-18T10:00:00.000Z",
        accessUrl: "https://affilova.example/access/a.b",
        refundWindowHours: 24,
        branding,
      }),
      vendorSaleEmail({
        orderNumber: HOSTILE,
        productTitle: HOSTILE,
        amountKobo: 100,
        vendorNetKobo: 90,
        heldUntil: "2026-11-25T10:00:00.000Z",
        branding,
      }),
      affiliateCommissionEmail({
        orderNumber: HOSTILE,
        productTitle: HOSTILE,
        commissionKobo: 10,
        heldUntil: "2026-11-25T10:00:00.000Z",
        branding,
      }),
      refundNoticeEmail({
        orderNumber: HOSTILE,
        productTitle: HOSTILE,
        amountKobo: 100,
        branding,
      }),
    ]

    for (const email of emails) {
      expect(email.html).not.toContain("<script>")
      expect(email.html).not.toContain('onerror=')
      expect(email.html).toContain("&lt;script&gt;")
    }
  })

  it("escapes the five characters that matter, once each", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;")
    expect(escapeHtml("already &amp; escaped")).toBe("already &amp;amp; escaped")
  })

  it("shows the money, the Lagos date and the refund sentence", () => {
    const email = purchaseReceiptEmail({
      orderNumber: "AFV-2026-000142",
      productTitle: "Instagram Growth Playbook",
      amountKobo: 2_500_000,
      paidAt: "2026-11-18T23:30:00.000Z",
      accessUrl: "https://affilova.example/access/a.b",
      refundWindowHours: 72,
      branding,
    })

    expect(email.html).toContain("₦25,000")
    // 23:30 UTC on 18 November is 00:30 on the 19th in Lagos.
    expect(email.html).toContain("19 Nov 2026")
    expect(email.html).toContain("within 72 hours of purchase")
    expect(email.subject).toBe("Your download link: Instagram Growth Playbook")
  })

  it("uses the brand button and the existing logo, and no tracking pixel", () => {
    const email = purchaseReceiptEmail({
      orderNumber: "AFV-2026-000142",
      productTitle: "Playbook",
      amountKobo: 100,
      paidAt: "2026-11-18T10:00:00.000Z",
      accessUrl: "https://affilova.example/access/a.b",
      refundWindowHours: 24,
      branding,
    })

    expect(email.html).toContain("#107F3E")
    expect(email.html).toContain("https://affilova.example/brand/email/affilova-logo-email.png")
    expect(email.html).not.toMatch(/width=["']?1["']?[^>]*height=["']?1/i)
    expect(email.html).not.toContain("utm_")
  })

  it("never shows the buyer to the vendor or the affiliate", () => {
    const vendor = vendorSaleEmail({
      orderNumber: "AFV-2026-000142",
      productTitle: "Playbook",
      amountKobo: 2_500_000,
      vendorNetKobo: 2_000_000,
      heldUntil: "2026-11-25T10:00:00.000Z",
      branding,
    })

    expect(vendor.text).toContain("The buyer's details are not included in this email.")
    expect(vendor.text).not.toContain("buyer@example.com")
  })

  it("snapshots the text versions", () => {
    expect(
      purchaseReceiptEmail({
        orderNumber: "AFV-2026-000142",
        productTitle: "Instagram Growth Playbook",
        amountKobo: 2_500_000,
        paidAt: "2026-11-18T10:00:00.000Z",
        accessUrl: "https://affilova.example/access/token.sig",
        refundWindowHours: 72,
        branding,
      }).text,
    ).toMatchSnapshot()

    expect(
      vendorSaleEmail({
        orderNumber: "AFV-2026-000142",
        productTitle: "Instagram Growth Playbook",
        amountKobo: 2_500_000,
        vendorNetKobo: 2_000_000,
        heldUntil: "2026-11-25T10:00:00.000Z",
        branding,
      }).text,
    ).toMatchSnapshot()

    expect(
      affiliateCommissionEmail({
        orderNumber: "AFV-2026-000142",
        productTitle: "Instagram Growth Playbook",
        commissionKobo: 500_000,
        heldUntil: "2026-11-25T10:00:00.000Z",
        branding,
      }).text,
    ).toMatchSnapshot()

    expect(
      refundNoticeEmail({
        orderNumber: "AFV-2026-000142",
        productTitle: "Instagram Growth Playbook",
        amountKobo: 2_500_000,
        branding,
      }).text,
    ).toMatchSnapshot()
  })
})
