"use client"

import {
  Archive,
  ArrowRight,
  WarningCircle,
  Package,
  Plus,
  MagnifyingGlass,
  Trash,
} from "@/components/ds/icons"
import { useState } from "react"
import { toast } from "sonner"

import { ChartFrame } from "@/components/ds/chart-frame"
import { ConfirmDialog } from "@/components/ds/confirm-dialog"
import { CopyField } from "@/components/ds/copy-field"
import { DataTable, type DataColumn } from "@/components/ds/data-table"
import { DateText } from "@/components/ds/date-text"
import { EmptyState } from "@/components/ds/empty-state"
import { Field } from "@/components/ds/field"
import { InlineAlert } from "@/components/ds/inline-alert"
import { Money } from "@/components/ds/money"
import { PageHeader } from "@/components/ds/page-header"
import { Section } from "@/components/ds/section"
import { Stat, StatGrid } from "@/components/ds/stat"
import { StatusBadge, type StatusMap } from "@/components/ds/status-badge"
import { Toolbar } from "@/components/ds/toolbar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { contrastRatio, formatRatio, textLevel } from "@/lib/design/contrast"
import {
  BACKGROUND,
  BRAND_500,
  BRAND_600,
  CHART_PALETTE,
  COLOUR_TOKENS,
  CONTAINERS,
  INK,
  MOTION,
  RADII,
  SPACING_SCALE,
  SUCCESS,
  SUCCESS_SUBTLE,
  SURFACE_MUTED,
  SURFACE_SUBTLE,
  TYPE_SCALE,
  type ColourToken,
} from "@/lib/design/tokens"

// The style guide.
//
// Every token, every primitive and every composed component, in every state, with
// the numbers that back them: the contrast ratio of each pair, the size and line
// height of each type step, the pixel value of each space. It is a working page,
// not a screenshot, so a change to a token shows up here the moment the CSS
// reloads.
//
// It is behind the admin host, which is behind the staff permission guard and the
// two-factor wrapper (app/hosts/admin/layout.tsx), and it is noindex. It makes no
// external requests: no images, no fonts beyond the self-hosted Inter, no scripts.
//
// It is a client component so the dialogs, sheets, menus and tooltips actually
// open. Everything it draws is the real component with real props.

function Subsection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-h3 text-foreground">{title}</h3>
      {note === undefined ? null : <p className="mt-1 max-w-reading text-small text-text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <p className="w-40 shrink-0 text-small font-medium text-text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function Swatch({ token, on }: { token: ColourToken; on: ColourToken }) {
  const ratio = contrastRatio(on.hex, token.hex)
  // The figure is printed on the swatch itself, so its own colour has to be the
  // one that is readable there: white on a dark swatch, ink on a pale one.
  const label = contrastRatio(INK.hex, token.hex) >= contrastRatio(BACKGROUND.hex, token.hex)
    ? INK.hex
    : BACKGROUND.hex

  return (
    <div className="rounded-md border border-border">
      <div
        className="flex h-16 items-end justify-end rounded-t-[5px] p-2"
        style={{ backgroundColor: token.hex }}
      >
        <span className="tabular text-caption" style={{ color: label }}>
          {formatRatio(ratio)}
        </span>
      </div>
      <div className="space-y-0.5 border-t border-border px-2.5 py-2">
        <p className="text-small font-medium text-foreground">{token.name}</p>
        <p className="tabular text-caption text-text-subtle">{token.hex}</p>
        <p className="text-caption text-text-muted">{token.role}</p>
      </div>
    </div>
  )
}

function TypeSpecimen({ entry }: { entry: (typeof TYPE_SCALE)[number] }) {
  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-caption font-medium text-text-subtle">
          {`${entry.name} · ${entry.size}/${entry.lineHeight} · ${entry.weight} · ${entry.tracking}em`}
        </p>
        <p className="text-caption text-text-subtle">{entry.use}</p>
      </div>
      <p className={`${entry.className} mt-1 text-foreground`}>
        Payouts arrive on weekdays
      </p>
    </div>
  )
}

const PAYOUT_STATUS: StatusMap<"paid" | "pending" | "failed" | "reversed" | "queued"> = {
  paid: { tone: "success", label: "Paid", icon: Archive, description: "The transfer settled." },
  pending: { tone: "warning", label: "Pending", icon: WarningCircle, description: "Waiting on approval." },
  failed: { tone: "danger", label: "Failed", icon: WarningCircle, description: "The bank rejected it." },
  reversed: { tone: "info", label: "Reversed", icon: Archive, description: "Returned after settlement." },
  queued: { tone: "neutral", label: "Queued", icon: Archive, description: "In the next run." },
}

interface CommissionRow {
  id: string
  day: string
  clicks: number
  orders: number
  commissionKobo: number
  status: "paid" | "pending" | "failed"
}

const COMMISSIONS: readonly CommissionRow[] = [
  { id: "c1", day: "2026-11-20T09:00:00.000Z", clicks: 1240, orders: 18, commissionKobo: 4_500_000, status: "paid" },
  { id: "c2", day: "2026-11-19T09:00:00.000Z", clicks: 980, orders: 12, commissionKobo: 3_120_000, status: "pending" },
  { id: "c3", day: "2026-11-18T09:00:00.000Z", clicks: 1410, orders: 21, commissionKobo: 5_675_000, status: "paid" },
]

const COMMISSION_COLUMNS: readonly DataColumn<CommissionRow>[] = [
  {
    key: "day",
    header: "Day",
    render: (row) => <DateText value={row.day} />,
  },
  {
    key: "clicks",
    header: "Clicks",
    align: "end",
    render: (row) => row.clicks.toLocaleString("en-NG"),
  },
  {
    key: "orders",
    header: "Orders",
    align: "end",
    render: (row) => row.orders.toLocaleString("en-NG"),
  },
  {
    key: "commission",
    header: "Commission",
    align: "end",
    render: (row) => <Money kobo={row.commissionKobo} />,
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge status={row.status} map={PAYOUT_STATUS} />,
  },
]

export function DesignSystemGuide() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dangerOpen, setDangerOpen] = useState(false)

  return (
    <div className="space-y-8">
      <Toaster position="bottom-right" />

      <PageHeader
        title="Design system"
        description="The tokens, the primitives and the composed components this product is built from, with the measurements behind each one."
        breadcrumbs={[{ label: "Admin", href: "/" }, { label: "Design system" }]}
      />

      <Section id="principles" title="Principles" description="Five rules that decide most of the questions.">
        <ol className="max-w-reading space-y-2 text-dense text-text-muted">
          <li>
            <span className="font-medium text-foreground">Restraint over decoration.</span> A page is
            type, space and a 1px rule. If a border or a shadow is not carrying information, it goes.
          </li>
          <li>
            <span className="font-medium text-foreground">Hierarchy from type, not from colour.</span>{" "}
            Size, weight and space say what matters. Green is an accent for the action and the active
            state, never a background wash.
          </li>
          <li>
            <span className="font-medium text-foreground">Real product, real numbers.</span> Show the
            table, the money, the status. No stock photographs of cash, no invented statistics.
          </li>
          <li>
            <span className="font-medium text-foreground">Say exactly what happens.</span> A
            confirmation names the action and its consequence. A status is a word and an icon, not a
            colour.
          </li>
          <li>
            <span className="font-medium text-foreground">Quiet by default, loud only for danger.</span>{" "}
            One primary action per view. Destructive actions are the only thing allowed to shout.
          </li>
        </ol>
      </Section>

      <Section
        id="colour"
        title="Colour"
        description="Each swatch is measured against the colour it is drawn on. The figure printed on the swatch is the same one lib/design/contrast.test.ts enforces."
      >
        <Subsection title="Neutrals" note="Derived from the ink. The ink is text, not a surface.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COLOUR_TOKENS.slice(0, 9).map((token) => (
              <Swatch key={token.cssVar} token={token} on={INK} />
            ))}
          </div>
        </Subsection>

        <div className="mt-6">
          <Subsection title="Brand" note="Green is the accent: 500 for graphics, 600 for text and primary actions.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLOUR_TOKENS.slice(9, 14).map((token) => (
                <Swatch key={token.cssVar} token={token} on={BACKGROUND} />
              ))}
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection
            title="Semantic pairs"
            note="A text colour and the pale surface it was measured on. Each pair is 4.5:1 or better, and every one is always drawn with an icon and a word."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { name: "Success", fg: SUCCESS, bg: SUCCESS_SUBTLE },
                { name: "Warning", fg: COLOUR_TOKENS[16], bg: COLOUR_TOKENS[17] },
                { name: "Danger", fg: COLOUR_TOKENS[18], bg: COLOUR_TOKENS[19] },
                { name: "Info", fg: COLOUR_TOKENS[20], bg: COLOUR_TOKENS[21] },
              ].map((pair) => (
                <div
                  key={pair.name}
                  className="rounded-md border p-3"
                  style={{ backgroundColor: pair.bg.hex, borderColor: pair.fg.hex, color: pair.fg.hex }}
                >
                  <p className="text-small font-medium">{pair.name}</p>
                  <p className="tabular text-caption">{formatRatio(contrastRatio(pair.fg.hex, pair.bg.hex))}</p>
                  <p className="text-caption">{`${pair.fg.hex} on ${pair.bg.hex}`}</p>
                </div>
              ))}
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection
            title="Chart series"
            note="Five hues, each readable as a label on white, and each with its own marker shape and dash pattern, so two series are never told apart by colour alone."
          >
            <ul className="space-y-2">
              {CHART_PALETTE.map((series) => (
                <li key={series.name} className="flex items-center gap-3 text-small text-text-muted">
                  <svg aria-hidden="true" viewBox="0 0 32 12" className="h-3 w-8" style={{ color: series.hex }}>
                    <line
                      x1="0"
                      y1="6"
                      x2="32"
                      y2="6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={series.dash === "none" ? undefined : series.dash}
                    />
                    <circle cx="16" cy="6" r="3" fill="currentColor" />
                  </svg>
                  <span className="font-medium text-foreground">{series.name}</span>
                  <span className="tabular text-caption text-text-subtle">{series.hex}</span>
                  <span className="text-caption">{`marker: ${series.marker} · dash: ${series.dash}`}</span>
                  <span className="tabular text-caption">{formatRatio(contrastRatio(series.hex, BACKGROUND.hex))}</span>
                </li>
              ))}
            </ul>
          </Subsection>
        </div>
      </Section>

      <Section id="type" title="Type" description="Inter, self-hosted through next/font. One scale for the product, and the two display sizes reserved for public pages.">
        <div>
          {TYPE_SCALE.map((entry) => (
            <TypeSpecimen key={entry.className} entry={entry} />
          ))}
        </div>

        <div className="mt-5 rounded-md border border-border bg-surface-subtle p-4">
          <p className="text-small font-medium text-foreground">Tabular figures</p>
          <p className="mt-1 max-w-reading text-small text-text-muted">
            Money, counts and anything compared column to column is set in tabular lining figures, so a
            column does not shift when a digit changes. The first block is tabular, the second is not.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-caption text-text-subtle">tabular</p>
              <p className="tabular text-body text-foreground">₦1,199.00</p>
              <p className="tabular text-body text-foreground">₦1,200.00</p>
              <p className="tabular text-body text-foreground">₦8,888.00</p>
            </div>
            <div>
              <p className="text-caption text-text-subtle">proportional (do not use for numbers)</p>
              <p className="text-body text-foreground">₦1,199.00</p>
              <p className="text-body text-foreground">₦1,200.00</p>
              <p className="text-body text-foreground">₦8,888.00</p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="space" title="Space, shape and motion" description="A 4px base, four radii, one shadow for overlays, and 150ms.">
        <Subsection title="Spacing" note="Every gap and every padding is a multiple of 4px.">
          <ul className="space-y-1.5">
            {SPACING_SCALE.map((step) => (
              <li key={step.token} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-caption text-text-subtle">{`${step.token} ${step.px}`}</span>
                <span className="h-3 rounded-sm bg-brand-500" style={{ width: step.px * 3 }} />
                <span className="text-caption text-text-muted">{step.use}</span>
              </li>
            ))}
          </ul>
        </Subsection>

        <div className="mt-6">
          <Subsection title="Radii" note="sm 6, md 8, lg 12, xl 16. A pill is reserved for a status; an avatar is the only circle.">
            <div className="flex flex-wrap gap-4">
              {RADII.map((radius) => (
                <div key={radius.token} className="w-32">
                  <div
                    className="h-16 border border-border-control bg-surface-subtle"
                    style={{ borderRadius: radius.px }}
                  />
                  <p className="mt-1 text-caption text-text-muted">{`${radius.token} · ${radius.px}px`}</p>
                  <p className="text-caption text-text-subtle">{radius.use}</p>
                </div>
              ))}
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Focus ring" note="2px brand-500, 2px out, in the page colour. 3.07:1 on white, which is why it is always drawn over white.">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-dense font-medium text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-background"
              >
                Primary action, focused
              </button>
              <a
                href="#top"
                className="rounded-sm text-dense font-medium text-brand-600 underline underline-offset-2 ring-2 ring-ring ring-offset-2 ring-offset-background"
              >
                A focused link
              </a>
              <input
                readOnly
                value="A focused input"
                className="h-control-md rounded-md border border-border-control px-3 text-dense text-foreground ring-2 ring-ring ring-offset-2 ring-offset-background"
              />
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Motion" note={MOTION.reducedMotion}>
            <p className="text-dense text-text-muted">
              {`Transitions are ${MOTION.duration} ${MOTION.easing}. Only colour, opacity and transform are animated. Nothing moves on load, nothing bounces, nothing loops.`}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-8 w-8 rounded-md bg-surface-muted transition-colors duration-150 hover:bg-brand-100" />
              <span className="text-caption text-text-subtle">hover this square: 150ms colour only</span>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Containers" note="Three widths, by kind of page.">
            <ul className="space-y-1 text-dense text-text-muted">
              {CONTAINERS.map((container) => (
                <li key={container.token}>
                  <span className="font-medium text-foreground">{container.token}</span>
                  {` · ${container.width} · ${container.use}`}
                </li>
              ))}
            </ul>
          </Subsection>
        </div>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        description="Three heights (36, 44, 52), six variants, and the same focus ring on all of them. Hover is shown forced, so it can be seen in a screenshot."
      >
        <Row label="Default">
          <Button>Send payout</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Reject</Button>
          <Button variant="link">Read the policy</Button>
        </Row>

        <Row label="Hover (forced)">
          <span className="inline-flex h-control-md items-center justify-center rounded-md bg-brand-700 px-4 text-dense font-medium text-primary-foreground">
            Send payout
          </span>
          <span className="inline-flex h-control-md items-center justify-center rounded-md border border-border-control bg-surface-muted px-4 text-dense font-medium text-foreground">
            Outline
          </span>
          <span className="inline-flex h-control-md items-center justify-center rounded-md bg-danger px-4 text-dense font-medium text-destructive-foreground">
            Reject
          </span>
        </Row>

        <Row label="Sizes">
          <Button size="sm">Small 36</Button>
          <Button size="default">Default 44</Button>
          <Button size="lg">Large 52</Button>
          <Button size="icon" aria-label="Add a product">
            <Plus aria-hidden="true" />
          </Button>
        </Row>

        <Row label="Focus">
          <span className="inline-flex h-control-md items-center justify-center rounded-md bg-primary px-4 text-dense font-medium text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-background">
            Focused
          </span>
          <span className="inline-flex h-control-md items-center justify-center rounded-md border border-border-control bg-background px-4 text-dense font-medium text-foreground ring-2 ring-ring ring-offset-2 ring-offset-background">
            Focused outline
          </span>
        </Row>

        <Row label="Disabled">
          <Button disabled>Send payout</Button>
          <Button variant="outline" disabled>
            Outline
          </Button>
        </Row>

        <Row label="Loading">
          <Button loading>Send payout</Button>
          <Button variant="outline" loading>
            Saving
          </Button>
        </Row>

        <Row label="With an icon">
          <Button>
            <Plus aria-hidden="true" />
            New product
          </Button>
          <Button variant="outline">
            Continue
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button variant="ghost" aria-label="Delete">
            <Trash aria-hidden="true" />
          </Button>
        </Row>
      </Section>

      <Section id="inputs" title="Inputs" description="44px tall, a 1px border that reaches 3:1, and the system focus ring. The error state is a border and a message, never the border alone.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Amount" id="guide-amount" help="In naira. The minimum is ₦1,000." required>
            {(field) => <Input {...field} inputMode="decimal" placeholder="1,500" />}
          </Field>

          <Field label="Amount" id="guide-amount-error" error="Enter an amount of at least ₦1,000." required>
            {(field) => <Input {...field} inputMode="decimal" defaultValue="400" />}
          </Field>

          <Field label="Bank account" id="guide-bank" help="Where the money is sent.">
            {(field) => (
              <Select defaultValue="gtb">
                <SelectTrigger id={field.id} aria-describedby={field["aria-describedby"]}>
                  <SelectValue placeholder="Choose a bank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gtb">Guaranty Trust Bank</SelectItem>
                  <SelectItem value="zenith">Zenith Bank</SelectItem>
                  <SelectItem value="kuda">Kuda Microfinance Bank</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label="Reference" id="guide-reference" help="Shown on the recipient's statement.">
            {(field) => <Input {...field} defaultValue="AFF-2026-0042" />}
          </Field>

          <Field label="Note to the reviewer" id="guide-note" help="Optional. Visible to staff only.">
            {(field) => <Textarea {...field} placeholder="Anything the reviewer should know" />}
          </Field>

          <Field label="Locked field" id="guide-locked" help="Set when the account was verified.">
            {(field) => <Input {...field} defaultValue="Ada Okonkwo" disabled />}
          </Field>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <Checkbox id="guide-checkbox" defaultChecked />
            <Label htmlFor="guide-checkbox" className="text-dense text-foreground">
              Email me when a payout is sent
            </Label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox id="guide-checkbox-disabled" disabled />
            <Label htmlFor="guide-checkbox-disabled" className="text-dense text-text-subtle">
              A disabled choice
            </Label>
          </div>

          <RadioGroup defaultValue="weekly" className="gap-2">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="daily" id="guide-radio-daily" />
              <Label htmlFor="guide-radio-daily" className="text-dense text-foreground">
                Every day
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="weekly" id="guide-radio-weekly" />
              <Label htmlFor="guide-radio-weekly" className="text-dense text-foreground">
                Once a week
              </Label>
            </div>
          </RadioGroup>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <Label htmlFor="guide-switch" className="text-dense text-foreground">
              Automatic payouts
            </Label>
            <Switch id="guide-switch" defaultChecked />
          </div>
        </div>
      </Section>

      <Section id="controls" title="Tabs, badges and menus" description="The small controls: one active state, one shape for a label, one menu.">
        <Subsection title="Tabs">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="links">Links</TabsTrigger>
              <TabsTrigger value="earnings">Earnings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-dense text-text-muted">
              The panel for the first tab.
            </TabsContent>
            <TabsContent value="links" className="text-dense text-text-muted">
              The panel for the second tab.
            </TabsContent>
            <TabsContent value="earnings" className="text-dense text-text-muted">
              The panel for the third tab.
            </TabsContent>
          </Tabs>
        </Subsection>

        <div className="mt-6">
          <Subsection title="Badges" note="A badge is a quiet label. A status is a StatusBadge, below.">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Beta</Badge>
              <Badge variant="secondary">Draft</Badge>
              <Badge variant="outline">Archived</Badge>
              <Badge variant="destructive">Suspended</Badge>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Dropdown menu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Product</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Edit details</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuItem>Archive</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Pagination">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href="#top" />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#top" isActive>
                    1
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#top">2</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#top">3</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href="#top" />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </Subsection>
        </div>
      </Section>

      <Section id="overlays" title="Overlays" description="The only place a shadow is allowed. Each one opens on click: this page is live, not a screenshot.">
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a bank account</DialogTitle>
                <DialogDescription>
                  We check the account name against your profile before a payout can be sent.
                </DialogDescription>
              </DialogHeader>
              <p className="text-dense text-text-muted">
                The dialog is 12px radius, a 1px border, and the overlay is the ink at 40%.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setDialogOpen(false)}>Continue</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>On a phone, filters arrive from the side like this.</SheetDescription>
              </SheetHeader>
              <p className="mt-4 text-dense text-text-muted">The sheet is the same surface as a dialog.</p>
            </SheetContent>
          </Sheet>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover for a tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>
                Earnings per 100 clicks, over the range you picked.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant="outline"
            onClick={() => {
              toast("Payout settings saved", { description: "The next run will use them." })
            }}
          >
            Show a toast
          </Button>
        </div>
      </Section>

      <Section id="primitives" title="Table, card, alert, skeleton" description="The primitives a page is assembled from, at the sizes the product uses.">
        <Subsection title="Table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>20 Nov 2026</TableCell>
                <TableCell className="tabular text-right">18</TableCell>
                <TableCell className="tabular text-right">₦45,000</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>19 Nov 2026</TableCell>
                <TableCell className="tabular text-right">12</TableCell>
                <TableCell className="tabular text-right">₦31,200</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Subsection>

        <div className="mt-6">
          <Subsection title="Card">
            <Card className="max-w-sm">
              <CardHeader>
                <CardTitle>Payout account</CardTitle>
                <CardDescription>Guaranty Trust Bank ····4821</CardDescription>
              </CardHeader>
              <CardContent className="text-dense text-text-muted">
                Verified on 12 Nov 2026. A 1px border and no shadow.
              </CardContent>
            </Card>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Alert">
            <div className="space-y-2">
              <Alert>
                <AlertTitle>Nothing has changed yet</AlertTitle>
                <AlertDescription>This alert is for a neutral note.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <AlertTitle>The transfer was rejected</AlertTitle>
                <AlertDescription>The account name did not match your profile.</AlertDescription>
              </Alert>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Skeleton" note="The shape of what is coming, hidden from screen readers.">
            <div className="max-w-sm space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-8 w-full" />
            </div>
          </Subsection>
        </div>
      </Section>

      <Section id="composed" title="Composed components" description="The pieces a page is made of. These are what screens should reach for first.">
        <Subsection title="PageHeader" note="One h1 per page, an optional description, breadcrumbs and the page actions.">
          <div className="rounded-md border border-border p-4">
            <PageHeader
              headingLevel={2}
              title="Payout details"
              description="One withdrawal, what it was charged, and where it went."
              breadcrumbs={[{ label: "Withdrawals", href: "#top" }, { label: "WD-0042" }]}
              actions={
                <>
                  <Button variant="outline" size="sm">
                    Download receipt
                  </Button>
                  <Button size="sm">Send again</Button>
                </>
              }
            />
          </div>
        </Subsection>

        <div className="mt-6">
          <Subsection title="Stat" note="A number, its name, and one line of context. Tabular, always.">
            <StatGrid>
              <Stat label="Available" value="₦18,250" hint="Ready to withdraw" />
              <Stat label="Pending" value="₦3,200" hint="Clears in 7 days" />
              <Stat label="Paid this month" value="₦45,000" trend="12% more than October" />
              <Stat label="Failed transfers" value="1" hint="Rejected by the bank" flag="Needs a look" />
            </StatGrid>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Money" note="Kobo in, naira out, tabular. A negative amount keeps its minus.">
            <div className="space-y-1 text-body text-foreground">
              <p>
                <Money kobo={4_500_000} />
              </p>
              <p>
                <Money kobo={123_456_789} />
              </p>
              <p>
                <Money kobo={120_000} sign />
              </p>
              <p>
                <Money kobo={-250_000} toneNegative />
              </p>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="DateText" note="Africa/Lagos, one format everywhere. An empty value says so.">
            <div className="space-y-1 text-dense text-foreground">
              <p>
                <DateText value="2026-11-20T09:12:00.000Z" withTime />
              </p>
              <p>
                <DateText value="2026-11-20T09:12:00.000Z" />
              </p>
              <p>
                <DateText value={null} fallback="Not paid yet" />
              </p>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="StatusBadge" note="A typed map from status to tone, word and icon. Never colour alone.">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="paid" map={PAYOUT_STATUS} size="md" />
              <StatusBadge status="pending" map={PAYOUT_STATUS} size="md" />
              <StatusBadge status="failed" map={PAYOUT_STATUS} size="md" />
              <StatusBadge status="reversed" map={PAYOUT_STATUS} size="md" />
              <StatusBadge status="queued" map={PAYOUT_STATUS} size="md" />
              <StatusBadge status="not-in-the-map" map={PAYOUT_STATUS} size="md" />
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="InlineAlert" note="Info and success are polite; warning and danger interrupt.">
            <div className="space-y-2">
              <InlineAlert tone="info" title="How this is calculated">
                Commission is 12% of the order total, before the platform fee.
              </InlineAlert>
              <InlineAlert tone="success">Your payout settings were saved.</InlineAlert>
              <InlineAlert tone="warning" title="Payouts are paused">
                Friday 25 December is a blackout day. The next run is Monday 28 December.
              </InlineAlert>
              <InlineAlert tone="danger" title="The transfer was rejected">
                The account name did not match your profile.{" "}
                <a href="#top" className="font-medium underline underline-offset-2">
                  Update the account
                </a>
              </InlineAlert>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Field" note="Label, help, error and the required marker, wired to the control by id.">
            <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
              <Field label="Account name" id="guide-ds-name" help="Exactly as the bank has it." required>
                {(field) => <Input {...field} placeholder="Ada Okonkwo" />}
              </Field>
              <Field label="Account number" id="guide-ds-number" error="A Nigerian account number is 10 digits.">
                {(field) => <Input {...field} defaultValue="12345" />}
              </Field>
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="CopyField" note="The value is selectable by hand, and the button says what happened.">
            <div className="max-w-lg">
              <CopyField label="Tracking link" value="https://affilova.com/r/ada-x7k2" />
            </div>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="Toolbar" note="Search, filters and the list action. It wraps on a phone instead of squeezing.">
            <Toolbar
              search={
                <Field label="Search products" id="guide-search" hideLabel>
                  {(field) => (
                    <div className="relative">
                      <MagnifyingGlass
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
                      />
                      <Input {...field} placeholder="Search products" className="pl-9" />
                    </div>
                  )}
                </Field>
              }
              filters={
                <Select defaultValue="all">
                  <SelectTrigger className="sm:w-44" aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              }
              actions={<Button>New product</Button>}
              status="3 of 24 shown"
            />
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection title="EmptyState" note="What is missing, why, and the one thing to do next.">
            <EmptyState
              icon={<Package className="h-5 w-5" />}
              title="No products yet"
              description="A product is a file, a price and a page. Add the first one and it appears in the marketplace once it passes review."
              primaryAction={<Button>New product</Button>}
              secondaryAction={
                <Button variant="ghost" asChild>
                  <a href="#top">How review works</a>
                </Button>
              }
            />
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection
            title="DataTable"
            note="One set of columns, a real table from md up and cards below it. Sorting and Load more are links, so the state lives in the URL."
          >
            <DataTable
              caption="Commission by day, 18 to 20 November 2026"
              columns={COMMISSION_COLUMNS}
              rows={COMMISSIONS}
              rowKey={(row) => row.id}
              empty={{ title: "No commissions in this range" }}
              sort={{ state: { column: "day", direction: "desc" }, links: { day: "#top", commission: "#top" } }}
              loadMore={{ href: "#top", label: "Load more days" }}
            />

            <p className="mt-6 text-small font-medium text-text-muted">Loading</p>
            <DataTable
              caption="Loading commission rows"
              columns={COMMISSION_COLUMNS}
              rows={[]}
              rowKey={(row) => row.id}
              empty={{ title: "No commissions in this range" }}
              loading
              loadingRows={3}
            />

            <p className="mt-6 text-small font-medium text-text-muted">Empty</p>
            <DataTable
              caption="Commission, empty range"
              columns={COMMISSION_COLUMNS}
              rows={[]}
              rowKey={(row) => row.id}
              empty={{
                title: "No commissions in this range",
                description: "Nothing was sold through your links between 18 and 20 November.",
                action: (
                  <Button variant="outline" size="sm" asChild>
                    <a href="#top">Widen the range</a>
                  </Button>
                ),
              }}
            />

            <p className="mt-6 text-small font-medium text-text-muted">Error</p>
            <DataTable
              caption="Commission, failed read"
              columns={COMMISSION_COLUMNS}
              rows={[]}
              rowKey={(row) => row.id}
              empty={{ title: "No commissions in this range" }}
              error="The commissions could not be read. Try again in a moment."
            />
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection
            title="ChartFrame"
            note="A title, a legend with a shape per series, and the numbers in words. A chart without a text alternative is a decoration."
          >
            <ChartFrame
              title="Commission per day"
              series={["Commission"]}
              textAlternative="Commission was ₦31,200 on 18 November, ₦45,000 on 19 November and ₦56,750 on 20 November. The total for the three days is ₦132,950."
            >
              <svg viewBox="0 0 320 96" className="h-24 w-full" role="img" aria-label="Three bars: 31,200, 45,000 and 56,750 naira">
                <line x1="0" y1="88" x2="320" y2="88" stroke="currentColor" className="text-border" />
                <rect x="24" y="52" width="56" height="36" fill={CHART_PALETTE[0].hex} />
                <rect x="132" y="34" width="56" height="54" fill={CHART_PALETTE[0].hex} />
                <rect x="240" y="16" width="56" height="72" fill={CHART_PALETTE[0].hex} />
              </svg>
            </ChartFrame>
          </Subsection>
        </div>

        <div className="mt-6">
          <Subsection
            title="ConfirmDialog"
            note="The title names the action, the consequence is in words, and an irreversible action asks for a word to be typed."
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                Open a confirmation
              </Button>
              <Button variant="destructive" onClick={() => setDangerOpen(true)}>
                Open a typed confirmation
              </Button>
            </div>

            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Cancel this withdrawal?"
              consequence="The ₦45,000 returns to your available balance and you can request it again on the next payout day."
              confirmLabel="Cancel withdrawal"
              onConfirm={() => {
                setConfirmOpen(false)
              }}
            />

            <ConfirmDialog
              open={dangerOpen}
              onOpenChange={setDangerOpen}
              tone="danger"
              title="Remove this bank account?"
              consequence="Payouts stop until you add another account. Money already sent cannot be recalled."
              confirmLabel="Remove account"
              typedConfirmation={{ word: "REMOVE" }}
              onConfirm={() => {
                setDangerOpen(false)
              }}
            />
          </Subsection>
        </div>
      </Section>

      <Section id="rules" title="Do and don't" description="The short version of docs/design-system.md.">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-small font-medium text-success">Do</p>
            <ul className="mt-2 space-y-1.5 text-dense text-text-muted">
              <li>Use one primary action per view, in brand-600 with a white label.</li>
              <li>Write in sentence case, with a verb: "Send payout", "Add a product".</li>
              <li>Show the real number from the product, with its range and its unit.</li>
              <li>Say what a status means in a word, and add an icon.</li>
              <li>Set money and counts in tabular figures, right aligned in a column.</li>
              <li>Separate things with a 1px rule and space.</li>
              <li>Give every interactive element the same 2px focus ring.</li>
              <li>Name the consequence in a confirmation, and the action on its button.</li>
            </ul>
          </div>
          <div>
            <p className="text-small font-medium text-danger">Don't</p>
            <ul className="mt-2 space-y-1.5 text-dense text-text-muted">
              <li>No gradients, no glow, no coloured wash behind a section.</li>
              <li>No stock photographs of cash, handshakes or people pointing at laptops.</li>
              <li>No emoji anywhere in the product.</li>
              <li>No invented statistics, testimonials or customer counts.</li>
              <li>No three-card grid of icons as a section.</li>
              <li>No all-caps headings, and no giant superlatives.</li>
              <li>No shadow on a card: depth belongs to an overlay.</li>
              <li>
                No "revolutionary", "seamless", "unlock" or "supercharge".
              </li>
            </ul>
          </div>
        </div>
      </Section>
    </div>
  )
}
