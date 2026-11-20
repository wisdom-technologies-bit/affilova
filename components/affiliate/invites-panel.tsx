"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { CopyButton } from "@/components/affiliate/copy-button"
import { DataTable, type Column } from "@/components/affiliate/data-table"
import { ErrorNotice, StatusPill } from "@/components/affiliate/status-pill"
import { ConfirmDialog } from "@/components/catalog/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { createInviteAction } from "@/lib/affiliate/actions"
import { appUrl } from "@/lib/identity/app-urls"
import { revokeInviteAction } from "@/lib/affiliate/read-actions"
import type { InviteRow } from "@/lib/affiliate/read-types"
import { formatCount } from "@/lib/affiliate/definitions"
import { formatLagosDate, formatLagosDateTime } from "@/lib/catalog/format"

// Invitations: make one, see it once, and take it back.
//
// The join link contains the only copy of the token that will ever exist: the
// database stores a hash. So the dialog shows the link once, says clearly that
// it cannot be shown again, and offers a copy button before the dialog closes.

function inviteState(invite: InviteRow): { status: "active" | "archived" | "blocked"; label: string } {
  if (invite.revokedAt !== null) {
    return { status: "archived", label: "Revoked" }
  }

  if (invite.uses >= invite.maxUses) {
    return { status: "archived", label: "Used up" }
  }

  if (Date.parse(invite.expiresAt) <= Date.now()) {
    return { status: "archived", label: "Expired" }
  }

  return { status: "active", label: "Active" }
}

export function InvitesPanel({
  invites,
  products,
  initialError,
}: {
  invites: readonly InviteRow[]
  products: readonly { id: string; title: string }[]
  initialError: string | null
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [productId, setProductId] = useState(products[0]?.id ?? "")
  const [maxUses, setMaxUses] = useState(1)
  const [expiresDays, setExpiresDays] = useState(14)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)

  const [revokeError, setRevokeError] = useState<string | null>(null)

  async function create(): Promise<void> {
    if (working || productId === "") {
      return
    }

    setWorking(true)
    setError(null)

    const result = await createInviteAction({ productId, maxUses, expiresDays })

    if (result.ok) {
      setCreatedUrl(appUrl("public", result.joinPath))
      router.refresh()
    } else {
      setError(result.error)
    }

    setWorking(false)
  }

  function closeCreate(): void {
    if (working) {
      return
    }

    setCreateOpen(false)
    setCreatedUrl(null)
    setError(null)
  }

  const columns: readonly Column<InviteRow>[] = [
    {
      key: "product",
      header: "Product",
      render: (invite) => <span className="text-brand-ink">{invite.productTitle}</span>,
    },
    {
      key: "uses",
      header: "Uses",
      align: "end",
      render: (invite) => `${formatCount(invite.uses)} of ${formatCount(invite.maxUses)}`,
    },
    { key: "expires", header: "Expires", render: (invite) => formatLagosDate(invite.expiresAt) },
    {
      key: "state",
      header: "State",
      render: (invite) => {
        const state = inviteState(invite)

        return <StatusPill status={state.status} label={state.label} />
      },
    },
    { key: "created", header: "Created", render: (invite) => formatLagosDateTime(invite.createdAt) },
    {
      key: "actions",
      header: "Actions",
      card: false,
      render: (invite) =>
        invite.revokedAt === null ? (
          <ConfirmDialog
            trigger="Revoke"
            triggerClassName="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            title="Revoke this invitation?"
            description="The join link stops working immediately. Affiliates who already joined through it keep their access."
            confirmLabel="Revoke invite"
            tone="destructive"
            onConfirm={async () => {
              const result = await revokeInviteAction({ inviteId: invite.id })

              if (result.ok) {
                setRevokeError(null)
                router.refresh()
                return true
              }

              setRevokeError(result.error)
              return false
            }}
          />
        ) : (
          <span className="text-sm text-muted-foreground">Revoked</span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      {initialError === null ? null : <ErrorNotice message={initialError} />}
      {revokeError === null ? null : <ErrorNotice message={revokeError} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          An invitation lets an affiliate promote one product without asking. Each link can be used
          a set number of times and expires on a date you choose.
        </p>

        <Dialog
          open={createOpen}
          onOpenChange={(next) => {
            if (!next) {
              closeCreate()
              return
            }

            setCreateOpen(true)
          }}
        >
          <DialogTrigger className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
            Create invite
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create an invitation</DialogTitle>
              <DialogDescription>
                The join link is shown once. Copy it before you close this dialog: it cannot be
                shown again, because only a hash of it is stored.
              </DialogDescription>
            </DialogHeader>

            {createdUrl === null ? (
              <div className="space-y-4">
                {products.length === 0 ? (
                  <p className="rounded-md border border-border px-3 py-2 text-sm text-brand-ink">
                    You need a live product before you can invite anyone to promote it.
                  </p>
                ) : (
                  <>
                    <div>
                      <label htmlFor="invite-product" className="block text-sm font-medium text-brand-ink">
                        Product
                      </label>
                      <select
                        id="invite-product"
                        value={productId}
                        onChange={(event) => setProductId(event.target.value)}
                        className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      >
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="invite-uses" className="block text-sm font-medium text-brand-ink">
                        How many affiliates may use it
                      </label>
                      <input
                        id="invite-uses"
                        type="number"
                        min={1}
                        max={1000}
                        value={maxUses}
                        onChange={(event) =>
                          setMaxUses(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))
                        }
                        className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">Between 1 and 1000.</p>
                    </div>

                    <div>
                      <label htmlFor="invite-days" className="block text-sm font-medium text-brand-ink">
                        Expires in
                      </label>
                      <input
                        id="invite-days"
                        type="number"
                        min={1}
                        max={90}
                        value={expiresDays}
                        onChange={(event) =>
                          setExpiresDays(Math.min(90, Math.max(1, Number(event.target.value) || 1)))
                        }
                        className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">Days, between 1 and 90.</p>
                    </div>
                  </>
                )}

                {error === null ? null : (
                  <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeCreate}
                    disabled={working}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void create()
                    }}
                    disabled={working || products.length === 0 || productId === ""}
                    className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {working ? "Creating…" : "Create invite"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p role="status" className="text-sm font-medium text-brand-ink">
                  This is the join link. It will not be shown again.
                </p>
                <p className="break-all rounded-md border border-border bg-muted px-3 py-2 text-sm text-brand-ink">
                  {createdUrl}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton value={createdUrl} label="Copy join link" />
                  <button
                    type="button"
                    onClick={closeCreate}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    I have copied it
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        caption="Your affiliate invitations"
        columns={columns}
        rows={invites}
        rowKey={(invite) => invite.id}
        emptyMessage="No invitations yet. Create one to let an affiliate promote a product without asking."
      />
    </div>
  )
}
