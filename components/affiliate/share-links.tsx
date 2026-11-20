import { Facebook, MessageCircle, Send } from "lucide-react"

import { shareUrls } from "@/lib/affiliate/links"

// The four places an affiliate shares a link, as ordinary links.
//
// Each opens in a new tab with rel="noopener noreferrer", and each has a word
// beside its icon so it is not a row of unlabelled shapes. The URLs come from
// shareUrls(), which encodes the title and the link.

export function ShareLinks({ url, title }: { url: string; title: string }) {
  const urls = shareUrls({ url, title })

  const items = [
    { key: "whatsapp", label: "WhatsApp", href: urls.whatsapp, Icon: MessageCircle },
    { key: "x", label: "X", href: urls.x, Icon: Send },
    { key: "facebook", label: "Facebook", href: urls.facebook, Icon: Facebook },
    { key: "telegram", label: "Telegram", href: urls.telegram, Icon: Send },
  ] as const

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ key, label, href, Icon }) => (
        <li key={key}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {label}
          </a>
        </li>
      ))}
    </ul>
  )
}
