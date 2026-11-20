import { DataTable, type Column } from "@/components/affiliate/data-table"
import { DecisionActions } from "@/components/affiliate/decision-actions"
import { StatusPill } from "@/components/affiliate/status-pill"
import { ACCESS_STATUS_WORDS, type AffiliateRequestRow } from "@/lib/affiliate/read-types"
import { formatLagosDateTime } from "@/lib/catalog/format"

// The vendor's access requests, one status at a time.
//
// Each row is one affiliate and one product. The note they wrote is shown in
// full, and the decision buttons sit on the row, so the vendor does not have to
// open anything to act.

export function RequestsTable({
  requests,
  showActions = false,
}: {
  requests: readonly AffiliateRequestRow[]
  showActions?: boolean
}) {
  const columns: Column<AffiliateRequestRow>[] = [
    {
      key: "affiliate",
      header: "Affiliate",
      render: (row) => <span className="text-brand-ink">{row.username}</span>,
    },
    { key: "product", header: "Product", render: (row) => row.productTitle },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusPill status={row.status} label={ACCESS_STATUS_WORDS[row.status]} />,
    },
    {
      key: "note",
      header: "Their note",
      render: (row) =>
        row.note === null ? (
          <span className="text-muted-foreground">No note</span>
        ) : (
          <span className="text-brand-ink">{row.note}</span>
        ),
    },
    {
      key: "requested",
      header: "Requested",
      render: (row) => formatLagosDateTime(row.requestedAt),
    },
  ]

  if (showActions) {
    columns.push({
      key: "actions",
      header: "Decision",
      card: false,
      render: (row) => <DecisionActions request={row} />,
    })
  }

  return (
    <DataTable
      caption="Affiliates who asked to promote your products"
      columns={columns}
      rows={requests}
      rowKey={(row) => `${row.affiliateId}-${row.productId}`}
      emptyMessage="No requests here yet. Affiliates find your products in the marketplace and ask from there."
    />
  )
}
