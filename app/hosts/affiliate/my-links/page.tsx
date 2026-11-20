import { PageHeader } from "@/components/app-shell/page-header"
import { LinksView } from "@/components/affiliate/links-view"
import { ErrorNotice } from "@/components/affiliate/status-pill"
import { getLinkStatsAction } from "@/lib/affiliate/read-actions"
import type { LinkStat, Page } from "@/lib/affiliate/read-types"
import { readRange, type SearchParams } from "@/lib/dates/range-params"

// My links: every link this affiliate owns, with its numbers for the range.
//
// The range only changes the numbers; the links themselves are always all of
// them, newest first, so a link made before the range still appears with zeros.

export default async function AffiliateMyLinksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const now = new Date()
  const { range, error: rangeError } = readRange(params, now)

  const result = await getLinkStatsAction({
    from: range.from,
    to: range.to,
    limit: 20,
  })

  const initialPage: Page<LinkStat> = result.ok ? result.data : { items: [], nextCursor: null }

  return (
    <>
      <PageHeader title="My links" />
      {rangeError === null ? null : <ErrorNotice message={rangeError} />}
      <div className="mt-4">
        <LinksView
          initialPage={initialPage}
          initialError={result.ok ? null : result.error}
          from={range.from}
          to={range.to}
        />
      </div>
    </>
  )
}
