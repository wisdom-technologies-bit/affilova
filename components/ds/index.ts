// The design system.
//
// The primitives in components/ui are the shadcn building blocks, restyled to
// the tokens. Everything in this folder is the layer above them: the pieces a
// page is actually made of, with the product's rules baked in (one h1, a status
// is never colour alone, money is tabular, dates are Lagos, a destructive action
// says what it does).
//
// Usage rules, the anti-pattern list and the copy rules are in
// docs/design-system.md. Every component here is shown, in every state, at
// /design on the admin host.

export { ChartFrame, type ChartFrameProps } from "./chart-frame"
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog"
export { CopyField, type CopyFieldProps } from "./copy-field"
export {
  DataTable,
  type DataColumn,
  type DataTableEmpty,
  type DataTableProps,
  type DataTableSort,
} from "./data-table"
export { DateText, type DateTextProps } from "./date-text"
export { EmptyState, type EmptyStateProps } from "./empty-state"
export { Field, type FieldControlProps, type FieldProps } from "./field"
export { InlineAlert, type AlertTone, type InlineAlertProps } from "./inline-alert"
export { Money, type MoneyProps } from "./money"
export { PageHeader, type Breadcrumb, type PageHeaderProps } from "./page-header"
export { Section, type SectionProps } from "./section"
export { Stat, StatGrid, type StatProps } from "./stat"
export {
  STATUS_ICONS,
  StatusBadge,
  UNKNOWN_STATUS,
  type StatusDescriptor,
  type StatusMap,
  type StatusTone,
} from "./status-badge"
export { Toolbar, type ToolbarProps } from "./toolbar"
