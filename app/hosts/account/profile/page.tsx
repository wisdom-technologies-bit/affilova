/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link"
import { redirect } from "next/navigation"

import { requireUser } from "@/lib/identity/guards"
import { signOutAction } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"

export default async function AccountProfilePage() {
  const { user } = await requireUser("/profile")

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Profile" />

      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-brand-muted uppercase tracking-wider block mb-1">Email Address (Read-only)</label>
            <div className="rounded-md border border-brand-border bg-brand-surface-muted px-3 py-2 text-sm font-mono text-brand-ink">
              {user.email}
            </div>
          </div>

          <div className="pt-4 border-t border-brand-border space-y-3">
            <h4 className="text-sm font-medium text-brand-ink">Data & Privacy</h4>
            <p className="text-sm text-brand-muted">
              Account deletion and data export are available on request through our{" "}
              <Link href="/contact" className="text-brand-primary underline hover:text-brand-primary-hover">
                contact page
              </Link>{" "}
              until self-service ships.
            </p>
          </div>

          <div className="pt-4 border-t border-brand-border">
            <form action={async () => {
              "use server"
              await signOutAction()
              redirect("/sign-in")
            }}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
