/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"
import { HelpCircle, ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"

export default function AccountSupportPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Support" />

      <Card>
        <CardHeader>
          <CardTitle>How can we help?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-brand-muted">
          <p>
            If you are experiencing issues with downloading a purchased file, need assistance with a refund, or have questions about an order, our support team is ready to help.
          </p>
          <p>
            Please reach out through our contact page with your order number and email address.
          </p>
          <div className="pt-2">
            <Button asChild>
              <Link href="/contact">
                Contact Support <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
