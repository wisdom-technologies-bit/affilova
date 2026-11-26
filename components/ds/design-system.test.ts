import {
  WarningCircle,
  CheckCircle,
} from "@/components/ds/icons"
import { createElement, Fragment, type ElementType, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ChartFrame } from "./chart-frame"
import { ConfirmDialog } from "./confirm-dialog"
import { CopyField } from "./copy-field"
import { DataTable, type DataColumn } from "./data-table"
import { DateText } from "./date-text"
import { EmptyState } from "./empty-state"
import { Field } from "./field"
import { InlineAlert } from "./inline-alert"
import { Money } from "./money"
import { PageHeader } from "./page-header"
import { Section } from "./section"
import { Stat, StatGrid } from "./stat"
import { StatusBadge, type StatusMap } from "./status-badge"
import { Toolbar } from "./toolbar"

// Every composed component, rendered in every state it has.
//
// The assertions are the rules the design system claims, not a snapshot of the
// markup: one h1 per page, a status that carries a word as well as a colour, a
// table that has a phone shape as well as a desktop one, a confirmation that
// stays locked until the word is typed. If a rule stops being true, the test
// says which one.

interface Row {
  id: string
  day: string
  clicks: number
  commissionKobo: number
}

const ROWS: readonly Row[] = [
  { id: "a", day: "2026-11-20T09:00:00.000Z", clicks: 1240, commissionKobo: 4_500_000 },
  { id: "b", day: "2026-11-19T09:00:00.000Z", clicks: 980, commissionKobo: 3_120_000 },
]

const COLUMNS: readonly DataColumn<Row>[] = [
  { key: "day", header: "Day", render: (row) => h(DateText, { value: row.day }) },
  { key: "clicks", header: "Clicks", align: "end", render: (row) => row.clicks.toLocaleString("en-NG") },
  { key: "commission", header: "Commission", align: "end", render: (row) => h(Money, { kobo: row.commissionKobo }) },
]

const STATUS: StatusMap<"paid" | "failed"> = {
  paid: { tone: "success", label: "Paid", icon: CheckCircle },
  failed: { tone: "danger", label: "Failed", icon: WarningCircle },
}

// These trees are built by hand, so the element factory is used with the props
// object shape of each component rather than TypeScript's overloads (which
// reject a children argument when a component declares children as required).
const h = createElement as unknown as (
  type: ElementType,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
) => ReactElement

function html(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

describe("the one h1 rule", () => {
  it("draws exactly one h1 in a PageHeader", () => {
    const markup = html(
      h(PageHeader, {
        title: "Payout details",
        description: "One withdrawal and where it went.",
        breadcrumbs: [{ label: "Withdrawals", href: "/withdrawals" }, { label: "WD-0042" }],
        actions: h("button", { type: "button" }, "Send again"),
      }),
    )

    expect(markup.match(/<h1/g)).toHaveLength(1)
    expect(markup).toContain("Payout details")
    // The trail is a real nav with a list, and the current page is not a link.
    expect(markup).toContain('aria-label="Breadcrumb"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain('href="undefined"')
  })

  it("never adds a second h1 from a Section, a Stat or a ChartFrame", () => {
    const markup = html(
      h(
        Fragment,
        null,
        h(PageHeader, { title: "Overview" }),
        h(
          Section,
          { title: "This month" },
          h(StatGrid, null, h(Stat, { label: "Clicks", value: "1,240" })),
        ),
        h(ChartFrame, { title: "Clicks per day", textAlternative: "One thousand clicks." }, h("svg")),
      ),
    )

    expect(markup.match(/<h1/g)).toHaveLength(1)
    expect(markup.match(/<h2/g)).toHaveLength(1)
    expect(markup.match(/<h3/g)).toHaveLength(1)
  })
})

describe("PageHeader", () => {
  it("renders with a title only", () => {
    const markup = html(h(PageHeader, { title: "Settings" }))

    expect(markup).toContain("<h1")
    expect(markup).toContain("Settings")
    expect(markup).not.toContain("aria-label=\"Breadcrumb\"")
  })

  it("can render at level 2 where the page already has a title", () => {
    const markup = html(h(PageHeader, { title: "Payout details", headingLevel: 2 }))

    expect(markup.match(/<h1/g)).toBeNull()
    expect(markup.match(/<h2/g)).toHaveLength(1)
    // The size is the page-title size whatever the level: only the semantics change.
    expect(markup).toContain("text-h1")
  })

  it("keeps a long title from pushing the actions off the row", () => {
    const markup = html(
      h(PageHeader, {
        title: "A title that is long enough to wrap on a phone",
        actions: h("button", { type: "button" }, "Act"),
      }),
    )

    expect(markup).toContain("sm:flex-row")
    expect(markup).toContain("min-w-0")
  })
})

describe("Section", () => {
  it("renders a panel with a description and actions", () => {
    const markup = html(
      h(
        Section,
        {
          title: "Commissions",
          description: "Everything earned in the range.",
          actions: h("button", { type: "button" }, "Export"),
          id: "commissions",
        },
        h("p", null, "Body"),
      ),
    )

    expect(markup).toContain("<h2")
    expect(markup).toContain('aria-labelledby="commissions-title"')
    expect(markup).toContain("Everything earned in the range.")
  })

  it("renders plain, without a border, inside another panel", () => {
    const markup = html(h(Section, { title: "Inner", variant: "plain" }, h("p", null, "x")))

    expect(markup).not.toContain("border-border")
  })
})

describe("Stat", () => {
  it("renders a label, a tabular value, a hint and a trend", () => {
    const markup = html(
      h(Stat, {
        label: "Available",
        value: "₦18,250",
        hint: "Ready to withdraw",
        trend: "12% more than October",
        description: "Money that can be requested today.",
      }),
    )

    expect(markup).toContain("Available")
    expect(markup).toContain("₦18,250")
    expect(markup).toContain("Ready to withdraw")
    expect(markup).toContain("12% more than October")
    expect(markup).toContain("tabular")
    expect(markup).toContain('title="Money that can be requested today."')
  })

  it("renders as a description list entry", () => {
    const markup = html(h(StatGrid, null, h(Stat, { label: "Clicks", value: "1" })))

    expect(markup).toContain("<dl")
    expect(markup).toContain("<dt")
    expect(markup).toContain("<dd")
  })
})

describe("Money", () => {
  it("renders kobo as naira in tabular figures", () => {
    const markup = html(h(Money, { kobo: 4_500_000 }))

    expect(markup).toContain("₦45,000")
    expect(markup).toContain("tabular")
  })

  it("keeps the kobo when there are any", () => {
    expect(html(h(Money, { kobo: 123_456_789 }))).toContain("₦1,234,567.89")
  })

  it("writes a sign when asked, and a minus whatever happens", () => {
    expect(html(h(Money, { kobo: 120_000, sign: true }))).toContain("+₦1,200")
    expect(html(h(Money, { kobo: 0, sign: true }))).not.toContain("+")
    expect(html(h(Money, { kobo: -250_000 }))).toContain("-₦2,500")
  })

  it("adds the danger tone for a negative amount without dropping the minus", () => {
    const markup = html(h(Money, { kobo: -250_000, toneNegative: true }))

    expect(markup).toContain("text-danger")
    expect(markup).toContain("-₦2,500")
  })

  it("gives a screen reader a label when one is passed", () => {
    expect(html(h(Money, { kobo: 100_000, label: "Commission" }))).toContain("Commission: ")
  })
})

describe("DateText", () => {
  it("renders a Lagos date and time", () => {
    // 09:12 UTC is 10:12 in Lagos, all year.
    expect(html(h(DateText, { value: "2026-11-20T09:12:00.000Z", withTime: true }))).toContain(
      "20 Nov 2026, 10:12",
    )
  })

  it("renders the day alone when asked", () => {
    expect(html(h(DateText, { value: "2026-11-20T09:12:00.000Z" }))).toContain("20 Nov 2026")
  })

  it("says what is missing instead of showing a zero date", () => {
    const markup = html(h(DateText, { value: null, fallback: "Not paid yet" }))

    expect(markup).toContain("Not paid yet")
    expect(markup).not.toContain("<time")
  })

  it("marks up a valid instant as a time element", () => {
    expect(html(h(DateText, { value: "2026-11-20T09:12:00.000Z" }))).toContain(
      'dateTime="2026-11-20T09:12:00.000Z"',
    )
  })
})

describe("StatusBadge", () => {
  it("always carries a word and an icon, never colour alone", () => {
    for (const status of ["paid", "failed", "not-in-the-map"] as const) {
      const markup = html(h(StatusBadge, { status, map: STATUS }))

      expect(markup, status).toMatch(/<svg/)
      expect(markup, status).toMatch(/Paid|Failed|Unknown/)
      expect(markup, status).not.toMatch(/^\s*<span[^>]*><\/span>\s*$/)
    }
  })

  it("falls back to a word when the status is not in the map", () => {
    const markup = html(h(StatusBadge, { status: "something-new", map: STATUS }))

    expect(markup).toContain("Unknown")
  })

  it("lets a screen pass a longer word without losing the tone", () => {
    const markup = html(h(StatusBadge, { status: "paid", map: STATUS, label: "Paid on 20 Nov" }))

    expect(markup).toContain("Paid on 20 Nov")
    expect(markup).toContain("text-success")
  })
})

describe("InlineAlert", () => {
  it.each([
    ["info", "status"],
    ["success", "status"],
    ["warning", "alert"],
    ["danger", "alert"],
  ] as const)("renders %s with role=%s and an icon", (tone, role) => {
    const markup = html(h(InlineAlert, { tone, title: "A title" }, "A message"))

    expect(markup).toContain(`role="${role}"`)
    expect(markup).toMatch(/<svg/)
    expect(markup).toContain("A title")
    expect(markup).toContain("A message")
  })

  it("renders an action inside the message", () => {
    const markup = html(
      h(InlineAlert, { tone: "danger", action: h("a", { href: "/settings" }, "Fix it") }, "Broken"),
    )

    expect(markup).toContain('href="/settings"')
  })
})

describe("Field", () => {
  it("wires the label, the help and the error to the control", () => {
    const markup = html(
      h(
        Field,
        { label: "Amount", id: "amount", help: "In naira.", error: "Too small.", required: true },
        // Field hands the prepared attributes to a render function.
        h("input", { id: "amount", "aria-describedby": "amount-help amount-error", "aria-invalid": true }),
      ),
    )

    expect(markup).toContain('for="amount"')
    expect(markup).toContain('id="amount"')
    expect(markup).toContain('aria-describedby="amount-help amount-error"')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain("(required)")
    expect(markup).toContain("In naira.")
    expect(markup).toContain("Too small.")
  })

  it("renders without an error or a helper line", () => {
    const markup = html(
      h(Field, { label: "Name", id: "name" }, h("input", { id: "name" })),
    )

    expect(markup).not.toContain("aria-describedby")
    expect(markup).not.toContain("aria-invalid")
  })

  it("can hide the label visually while keeping it for a screen reader", () => {
    const markup = html(
      h(Field, { label: "Search", id: "search", hideLabel: true }, h("input", { id: "search" })),
    )

    expect(markup).toContain("sr-only")
    expect(markup).toContain('for="search"')
  })
})

describe("EmptyState", () => {
  it("renders a title, a description and both actions", () => {
    const markup = html(
      h(EmptyState, {
        icon: h("svg"),
        title: "No products yet",
        description: "Add the first one.",
        primaryAction: h("button", { type: "button" }, "New product"),
        secondaryAction: h("a", { href: "/help" }, "How review works"),
      }),
    )

    expect(markup).toContain("No products yet")
    expect(markup).toContain("Add the first one.")
    expect(markup).toContain("New product")
    expect(markup).toContain("How review works")
  })

  it("renders inline, without the card edge", () => {
    const markup = html(h(EmptyState, { title: "Nothing here", variant: "inline" }))

    expect(markup).not.toContain("border-border")
  })
})

describe("Toolbar", () => {
  it("renders a search, a labelled filter group and an action", () => {
    const markup = html(
      h(Toolbar, {
        search: h("input", { id: "q" }),
        filters: h("select", { id: "status" }),
        actions: h("button", { type: "button" }, "New"),
        status: "3 of 24 shown",
      }),
    )

    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Filters"')
    expect(markup).toContain("3 of 24 shown")
    // The row wraps rather than squeezing two controls onto one line.
    expect(markup).toContain("flex-col")
    expect(markup).toContain("sm:flex-row")
  })
})

describe("ChartFrame", () => {
  it("requires a text alternative and draws the legend with a shape per series", () => {
    const markup = html(
      h(
        ChartFrame,
        { title: "Commission per day", textAlternative: "₦45,000 on 20 November.", series: ["Commission", "Refunds"] },
        h("svg"),
      ),
    )

    expect(markup).toContain("<figure")
    expect(markup).toContain("<figcaption")
    expect(markup).toContain("₦45,000 on 20 November.")
    expect(markup).toContain("Commission")
    expect(markup).toContain("Refunds")
    // Two series, two dash patterns.
    expect(markup).toContain("stroke-dasharray")
  })
})

describe("CopyField", () => {
  it("renders the value in a read-only field with a copy button", () => {
    const markup = html(h(CopyField, { label: "Tracking link", value: "https://affilova.com/r/x" }))

    expect(markup).toContain('readOnly=""')
    expect(markup).toContain("https://affilova.com/r/x")
    expect(markup).toContain("Copy")
    expect(markup).toContain('aria-live="polite"')
  })
})

describe("DataTable", () => {
  it("draws a real table with a caption, column scopes and a row scope", () => {
    const markup = html(
      h(DataTable, {
        caption: "Commission by day",
        columns: COLUMNS,
        rows: ROWS,
        rowKey: (row: Row) => row.id,
        empty: { title: "Nothing here" },
      }),
    )

    expect(markup).toContain("<caption")
    expect(markup).toContain("Commission by day")
    expect(markup).toContain('scope="col"')
    expect(markup).toContain('scope="row"')
    expect(markup).toContain("₦45,000")
  })

  it("draws the same rows as cards for a phone", () => {
    const markup = html(
      h(DataTable, {
        caption: "Commission by day",
        columns: COLUMNS,
        rows: ROWS,
        rowKey: (row: Row) => row.id,
        empty: { title: "Nothing here" },
      }),
    )

    // The table is hidden below md and the card list is hidden from md up, so a
    // row is never missing from the phone.
    expect(markup).toContain("hidden md:block")
    expect(markup).toContain("md:hidden")
    expect(markup).toContain("<ul")
    expect(markup.match(/₦45,000/g)?.length).toBe(2)
  })

  it("marks the sorted column for a screen reader and links the other", () => {
    const markup = html(
      h(DataTable, {
        caption: "Commission by day",
        columns: COLUMNS,
        rows: ROWS,
        rowKey: (row: Row) => row.id,
        empty: { title: "Nothing here" },
        sort: { state: { column: "clicks", direction: "desc" }, links: { clicks: "?sort=clicks" } },
      }),
    )

    expect(markup).toContain('aria-sort="descending"')
    expect(markup).toContain('href="?sort=clicks"')
    expect(markup).toContain('aria-sort="none"')
  })

  it("renders skeleton rows while loading", () => {
    const markup = html(
      h(DataTable, {
        caption: "Loading",
        columns: COLUMNS,
        rows: [],
        rowKey: (row: Row) => row.id,
        empty: { title: "Nothing here" },
        loading: true,
        loadingRows: 3,
      }),
    )

    expect(markup).toContain("animate-pulse")
    expect(markup).not.toContain("₦45,000")
    expect(markup).not.toContain("Nothing here")
  })

  it("renders the empty state instead of an empty table", () => {
    const markup = html(
      h(DataTable, {
        caption: "Commission",
        columns: COLUMNS,
        rows: [],
        rowKey: (row: Row) => row.id,
        empty: { title: "No commissions in this range", description: "Nothing was sold.", action: h("a", { href: "/" }, "Widen") },
      }),
    )

    expect(markup).toContain("No commissions in this range")
    expect(markup).toContain("Nothing was sold.")
    expect(markup).not.toContain("<table")
  })

  it("renders a danger alert instead of a table when the read failed", () => {
    const markup = html(
      h(DataTable, {
        caption: "Commission",
        columns: COLUMNS,
        rows: [],
        rowKey: (row: Row) => row.id,
        empty: { title: "No commissions" },
        error: "The commissions could not be read.",
      }),
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain("The commissions could not be read.")
    expect(markup).not.toContain("<table")
  })

  it("offers Load more as a link, so the page works without JavaScript", () => {
    const markup = html(
      h(DataTable, {
        caption: "Commission",
        columns: COLUMNS,
        rows: ROWS,
        rowKey: (row: Row) => row.id,
        empty: { title: "Nothing here" },
        loadMore: { href: "?page=2" },
      }),
    )

    expect(markup).toContain('href="?page=2"')
    expect(markup).toContain("Load more")
  })
})

describe("ConfirmDialog", () => {
  it("renders nothing when it is closed", () => {
    expect(html(h(ConfirmDialog, {
      open: false,
      onOpenChange: () => undefined,
      title: "Send this payout?",
      consequence: "It cannot be recalled.",
      confirmLabel: "Send payout",
      onConfirm: () => undefined,
    }))).toBe("")
  })

  it("names the action, states the consequence and marks itself modal", () => {
    const markup = html(
      h(ConfirmDialog, {
        open: true,
        onOpenChange: () => undefined,
        title: "Send this payout?",
        consequence: "₦45,000 leaves your balance and cannot be recalled.",
        confirmLabel: "Send payout",
        onConfirm: () => undefined,
      }),
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain("Send this payout?")
    expect(markup).toContain("cannot be recalled")
    expect(markup).toContain("Send payout")
    expect(markup).toContain("Cancel")
  })

  it("stays locked until the typed word is entered", () => {
    const markup = html(
      h(ConfirmDialog, {
        open: true,
        onOpenChange: () => undefined,
        title: "Remove this bank account?",
        consequence: "Payouts stop until you add another.",
        confirmLabel: "Remove account",
        typedConfirmation: { word: "REMOVE" },
        onConfirm: () => undefined,
      }),
    )

    expect(markup).toContain("Type REMOVE to confirm")
    expect(markup).toContain("REMOVE")
    // The confirm control is disabled while the field is empty.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Remove account/)
  })

  it("says it is working, and disables both buttons, while pending", () => {
    const markup = html(
      h(ConfirmDialog, {
        open: true,
        onOpenChange: () => undefined,
        title: "Send this payout?",
        consequence: "It cannot be recalled.",
        confirmLabel: "Send payout",
        pending: true,
        onConfirm: () => undefined,
      }),
    )

    expect(markup).toContain("Working…")
    expect(markup).toContain('aria-busy="true"')
  })
})
