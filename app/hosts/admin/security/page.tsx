import { PageHeader } from "@/components/app-shell/page-header"
import { SecurityPanel } from "@/components/ops/security-panel"
import { getSecurityOverviewAction } from "@/lib/ops/actions"

// The Security page: is the scanner working, is the pipeline moving, is the cron
// alive, and one button that proves the whole chain end to end.
//
// The read-only half is fetched here, on the server, so the page arrives with the
// numbers already in it. The button is the only interactive part, and it is the
// one thing on this page that writes anything.

export default async function AdminSecurityPage() {
  const result = await getSecurityOverviewAction()

  return (
    <>
      <PageHeader title="Security" />

      <p className="mb-6 text-sm text-muted-foreground">
        The malware scanner, the scan pipeline and the background queue. The self-test sends four
        known files through the real pipeline; it does not create a product or a file record.
      </p>

      <SecurityPanel
        overview={result.ok ? result.overview : null}
        overviewError={result.ok ? null : result.error}
        nowIso={new Date().toISOString()}
      />
    </>
  )
}
