import { Text } from "@react-email/components"
import type { ReactNode } from "react"

import { EMAIL_COLOURS, EMAIL_FONT_STACK, emailSpacePx } from "@/lib/design/tokens"

// A paragraph of body text.
//
// Text from a person (a product title, a reason) is passed as a child and React
// escapes it: a vendor's "<script>" is shown as those characters, never run.

export interface ParagraphProps {
  children: ReactNode
}

export function Paragraph({ children }: ParagraphProps) {
  return <Text style={style}>{children}</Text>
}

const style = {
  margin: `0 0 ${emailSpacePx("md")}px`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "15px",
  lineHeight: "24px",
  color: EMAIL_COLOURS.ink,
} as const
