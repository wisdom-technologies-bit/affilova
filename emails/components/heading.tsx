import { Heading as ReactEmailHeading } from "@react-email/components"
import type { ReactNode } from "react"

import { EMAIL_COLOURS, emailSpacePx } from "@/lib/design/tokens"

// The one heading of a message.
//
// It is an h1, and there is exactly one per email: the layout renders it from
// its `heading` prop, so no template can add a second one by accident. A mail
// client that styles headings itself still gets a readable size and colour.

export interface HeadingProps {
  children: ReactNode
}

export function Heading({ children }: HeadingProps) {
  return (
    <ReactEmailHeading as="h1" style={style}>
      {children}
    </ReactEmailHeading>
  )
}

const style = {
  margin: `0 0 ${emailSpacePx("lg")}px`,
  fontSize: "22px",
  lineHeight: "28px",
  fontWeight: 600,
  color: EMAIL_COLOURS.ink,
} as const
