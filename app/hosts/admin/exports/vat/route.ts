import { NextResponse } from "next/server"

import * as db from "@/lib/admin/db"
import { FinanceRpcError } from "@/lib/admin/db"
import { vatCsv, vatCsvFileName } from "@/lib/admin/csv"
import { catalogErrorMessage } from "@/lib/catalog/errors"
import { staffAal2RouteGuard } from "@/lib/identity/mfa"
import { can } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// GET /hosts/admin/exports/vat?period=YYYY-MM-01
//
// The VAT export for one month, as a CSV download.
//
// What it checks, in order: a signed-in person, the vat:manage permission, a
// period that is the first day of a month, and twenty exports an hour. Then it
// asks vat_export_rows, which takes the actor first and checks the role again
// inside the database.
//
// What it never contains: a buyer. Not an address, not a masked one, not a name.
// What it does contain is defused for a spreadsheet: a cell that starts with =,
// +, - or @ is prefixed with a single quote before it is written.

export const dynamic = "force-dynamic"

const PERIOD = /^\d{4}-\d{2}-01$/
const LIMIT = 20
const WINDOW_SECONDS = 60 * 60

export async function GET(request: Request): Promise<Response> {
  const user = await getAuthUser()

  if (user === null) {
    return new NextResponse("Sign in to continue.", { status: 401 })
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, "vat:manage")) {
    return new NextResponse("You do not have access to that.", { status: 403 })
  }

  // A route handler has no page around it, so the second factor is checked here
  // too. The answer is 403 with the same sentence the actions use.
  const mfa = await staffAal2RouteGuard("/admin")

  if (mfa !== null) {
    return mfa
  }

  const period = new URL(request.url).searchParams.get("period") ?? ""

  if (!PERIOD.test(period)) {
    return new NextResponse("Choose a VAT month.", { status: 400 })
  }

  const allowed = await rateLimit({
    key: rateLimitKey(["vat-export", user.id]),
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
    onError: "deny",
  })

  if (!allowed.allowed) {
    return new NextResponse(catalogErrorMessage("rate_limited"), { status: 429 })
  }

  try {
    const rows = await db.vatExportRows(user.id, period)
    const body = vatCsv(rows)

    // The export is a record of what staff took out of the building.
    await getSupabaseAdminClient()
      .from("audit_log")
      .insert({
        actor_id: user.id,
        action: "vat.exported",
        entity_type: "vat_period",
        entity_id: period,
        after: { rows: rows.length },
      })

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${vatCsvFileName(period)}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const code = error instanceof FinanceRpcError ? error.code : "unknown"

    logger.error("vat_export_failed", { code, error: error instanceof FinanceRpcError ? undefined : error })

    return new NextResponse(catalogErrorMessage(error), { status: 500 })
  }
}
