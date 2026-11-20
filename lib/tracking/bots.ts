// Bots and link previews.
//
// A tracked link is shared in a chat app, and the app fetches the page to build a
// preview. Those fetches must not count as clicks: they are one request from a
// data centre, they never set a cookie, and counting them would inflate every
// number an affiliate is paid on.
//
// The check is deliberately a list of substrings rather than a clever heuristic.
// A crawler that is not on the list is counted once, which is cheap; a real
// person who is on it would be missed, which is why the list holds only names
// that no browser sends.

/**
 * Lower-cased user agent fragments that mean "not a person".
 *
 * Grouped by what they are, so the list can be reviewed rather than guessed at.
 */
export const BOT_PATTERNS: readonly string[] = [
  // Search crawlers
  "googlebot",
  "bingbot",
  "duckduckbot",
  "yandex",
  "baidu",
  "applebot",
  "sogou",
  "seznambot",
  "petalbot",
  // Link preview fetchers: the ones that open a shared link in a chat
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "slackbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "pinterest",
  "embedly",
  "skypeuripreview",
  "redditbot",
  "quora link preview",
  // SEO and analytics crawlers
  "ahrefs",
  "semrush",
  "mj12bot",
  "dotbot",
  "rogerbot",
  "screaming frog",
  "serpstatbot",
  // Command line clients and automation
  "curl",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "okhttp",
  "axios",
  "node-fetch",
  "headless",
  "lighthouse",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  // Monitoring
  "uptimerobot",
  "pingdom",
  "statuscake",
  "better uptime",
]

/**
 * True when the request is a bot, a crawler, a preview fetcher or a script.
 *
 * An empty or missing user agent is true as well: every browser sends one, so a
 * request without it is a tool, and a tool is not a click.
 */
export function isBotOrPreview(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string") {
    return true
  }

  const value = userAgent.trim().toLowerCase()

  if (value === "") {
    return true
  }

  return BOT_PATTERNS.some((pattern) => value.includes(pattern))
}
