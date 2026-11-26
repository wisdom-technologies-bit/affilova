import { Text } from "@react-email/components"
import type { ReactNode } from "react"

import { EMAIL_COLOURS, EMAIL_FONT_STACK, emailSpacePx } from "@/lib/design/tokens"

// The third line: a footnote, a closing sentence, a note under a button.
//
// TEXT_SUBTLE is 4.90:1 on white, so this is still a line a person reads rather
// than decoration. It is never used for the only copy of something that matters:
// a link here is always repeated as a real link elsewhere in the message.

export interface SecondaryTextProps {
  children: ReactNode
}

export function SecondaryText({ children }: SecondaryTextProps) {
  return <Text style={style}>{children}</Text>
}

const style = {
  margin: `0 0 ${emailSpacePx("sm")}px`,
  fontFamily: EMAIL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "20px",
  color: EMAIL_COLOURS.subtle,
} as const
