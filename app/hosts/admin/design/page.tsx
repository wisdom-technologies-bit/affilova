import type { Metadata } from "next"

import { DesignSystemGuide } from "@/components/design-guide/guide"

// The style guide.
//
// It lives on the admin host, so it is behind the staff permission guard and the
// two-factor wrapper in app/hosts/admin/layout.tsx: a signed-in account that is
// not staff never reaches it, and neither does a staff account that has not
// completed its second factor. The layout also marks the whole admin host
// noindex; this page repeats it so a copied URL cannot be indexed on its own.
//
// The page is a server component and the guide inside it is a client component,
// because a style guide has to be able to open its own dialogs, sheets and
// tooltips. Nothing on it fetches anything: no images, no web fonts beyond the
// self-hosted Inter, no scripts from anywhere.

export const metadata: Metadata = {
  title: "Design system | Affilova Admin",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
}

export default function DesignSystemPage() {
  return <DesignSystemGuide />
}
