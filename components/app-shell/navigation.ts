// The four signed-in apps, their sections and the paths those sections are
// served at.
//
// The paths are the ones a visitor sees. On an app host the middleware has
// already rewritten the request to /hosts/<app><path>, so a link to "/products"
// stays "/products" in the address bar and resolves to the merchant shell.

export type ShellApp = "affiliate" | "merchant" | "account" | "admin"

export type NavItem = {
  label: string
  /** Relative to the app's host, which is where the shell is served. */
  path: string
}

export type ShellNavigation = {
  app: ShellApp
  label: string
  items: readonly NavItem[]
}

export const SHELL_NAVIGATION: Record<ShellApp, ShellNavigation> = {
  merchant: {
    app: "merchant",
    label: "Merchant",
    items: [
      { label: "Overview", path: "/" },
      { label: "Products", path: "/products" },
      { label: "Sales", path: "/sales" },
      { label: "Affiliates", path: "/affiliates" },
      { label: "Analytics", path: "/analytics" },
      { label: "Store", path: "/store" },
      { label: "Resources", path: "/resources" },
      { label: "Payout details", path: "/payout-details" },
      { label: "Settings", path: "/settings" },
    ],
  },
  affiliate: {
    app: "affiliate",
    label: "Affiliate",
    items: [
      { label: "Overview", path: "/" },
      { label: "Marketplace", path: "/marketplace" },
      { label: "My links", path: "/my-links" },
      { label: "Earnings", path: "/earnings" },
      { label: "Analytics", path: "/analytics" },
      { label: "Withdrawals", path: "/withdrawals" },
      { label: "Resources", path: "/resources" },
      { label: "Payout details", path: "/payout-details" },
      { label: "Settings", path: "/settings" },
    ],
  },
  account: {
    app: "account",
    label: "Account",
    items: [
      { label: "Purchases", path: "/" },
      { label: "Receipts", path: "/receipts" },
      { label: "Support", path: "/support" },
      { label: "Profile", path: "/profile" },
    ],
  },
  admin: {
    app: "admin",
    label: "Admin",
    items: [
      { label: "Overview", path: "/" },
      { label: "Users", path: "/users" },
      { label: "Products", path: "/products" },
      { label: "Withdrawals", path: "/withdrawals" },
      { label: "Transactions", path: "/transactions" },
      { label: "VAT", path: "/vat" },
      { label: "Support", path: "/support" },
      { label: "Blog", path: "/blog" },
      { label: "Settings", path: "/settings" },
    ],
  },
}

export const HOSTS_PREFIX = "/hosts"

/**
 * A pathname with the internal shell prefix removed, for deciding which nav
 * item is the current one.
 *
 * The middleware rewrites "/products" to "/hosts/merchant/products" but leaves
 * the address bar alone, so the server renders the internal path while the
 * browser reports the visible one. Both become "/products" here, which keeps
 * the server and client markup identical.
 */
export function shellPath(pathname: string | null, app: ShellApp): string {
  if (pathname === null || pathname === "") {
    return "/"
  }

  const prefix = `${HOSTS_PREFIX}/${app}`
  const withoutPrefix = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname
  const trimmed = withoutPrefix.replace(/\/+$/, "")

  return trimmed === "" ? "/" : trimmed
}
