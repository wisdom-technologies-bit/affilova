import { describe, expect, it } from "vitest"

import { BOT_PATTERNS, isBotOrPreview } from "./bots"

// A bot or a link preview must never be counted as a click.
//
// The table is the test: every name below is a real user agent string, and each
// one has to be recognised. The human entries are the counterweight: a browser
// that is wrongly treated as a bot loses a real click, which is worse than the
// other way round.

const BOT_AGENTS: readonly { name: string; userAgent: string }[] = [
  { name: "Googlebot", userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { name: "Googlebot smartphone", userAgent: "Mozilla/5.0 (Linux; Android 6.0.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0 Mobile Safari/537.36 (compatible; Googlebot/2.1)" },
  { name: "Bingbot", userAgent: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { name: "DuckDuckBot", userAgent: "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)" },
  { name: "Yandex", userAgent: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)" },
  { name: "Baidu", userAgent: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)" },
  { name: "Applebot", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)" },
  { name: "SeznamBot", userAgent: "Mozilla/5.0 (compatible; SeznamBot/3.2; +http://napoveda.seznam.cz/en/seznambot-intro/)" },
  { name: "PetalBot", userAgent: "Mozilla/5.0 (compatible; PetalBot; +https://webmaster.petalsearch.com/site/petalbot)" },
  { name: "Facebook preview", userAgent: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
  { name: "Facebook facebot", userAgent: "Facebot/1.0" },
  { name: "Twitter card", userAgent: "Twitterbot/1.0" },
  { name: "Slack preview", userAgent: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" },
  { name: "LinkedIn preview", userAgent: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)" },
  { name: "WhatsApp preview", userAgent: "WhatsApp/2.23.20.0 A" },
  { name: "WhatsApp iOS preview", userAgent: "WhatsApp/2.19.81 A" },
  { name: "Telegram preview", userAgent: "TelegramBot (like TwitterBot)" },
  { name: "Discord preview", userAgent: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" },
  { name: "Pinterest", userAgent: "Pinterest/0.2 (+http://www.pinterest.com/bot.html)" },
  { name: "Embedly", userAgent: "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)" },
  { name: "Skype preview", userAgent: "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5" },
  { name: "Reddit bot", userAgent: "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)" },
  { name: "Ahrefs", userAgent: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)" },
  { name: "Semrush", userAgent: "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)" },
  { name: "MJ12bot", userAgent: "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)" },
  { name: "Dotbot", userAgent: "Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)" },
  { name: "Rogerbot", userAgent: "Mozilla/5.0 (compatible; rogerBot/1.0; UrlCrawler)" },
  { name: "Screaming Frog", userAgent: "Screaming Frog SEO Spider/19.2" },
  { name: "curl", userAgent: "curl/8.4.0" },
  { name: "wget", userAgent: "Wget/1.21.3" },
  { name: "python-requests", userAgent: "python-requests/2.31.0" },
  { name: "Go client", userAgent: "Go-http-client/1.1" },
  { name: "Headless Chrome", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/119.0.0.0 Safari/537.36" },
  { name: "Lighthouse", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Chrome-Lighthouse" },
  { name: "PhantomJS", userAgent: "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1" },
  { name: "Puppeteer", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/90.0.4430.212 Safari/537.36 Puppeteer" },
  { name: "UptimeRobot", userAgent: "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)" },
  { name: "Pingdom", userAgent: "Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)" },
]

const HUMAN_AGENTS: readonly { name: string; userAgent: string }[] = [
  { name: "Chrome on Windows", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
  { name: "Safari on iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1" },
  { name: "Chrome on Android", userAgent: "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36" },
  { name: "Firefox on Linux", userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0" },
]

describe("isBotOrPreview", () => {
  it("recognises every crawler and preview fetcher in the table", () => {
    for (const entry of BOT_AGENTS) {
      expect(isBotOrPreview(entry.userAgent), entry.name).toBe(true)
    }
  })

  it("covers at least thirty user agents", () => {
    expect(BOT_AGENTS.length).toBeGreaterThanOrEqual(30)
  })

  it("treats an empty or missing user agent as a bot", () => {
    expect(isBotOrPreview("")).toBe(true)
    expect(isBotOrPreview("   ")).toBe(true)
    expect(isBotOrPreview(null)).toBe(true)
    expect(isBotOrPreview(undefined)).toBe(true)
  })

  it("matches whatever the case", () => {
    expect(isBotOrPreview("GOOGLEBOT/2.1")).toBe(true)
    expect(isBotOrPreview("WhatsApp/2.23")).toBe(true)
    expect(isBotOrPreview("TELEGRAMBOT")).toBe(true)
  })

  it("lets a real browser through", () => {
    for (const entry of HUMAN_AGENTS) {
      expect(isBotOrPreview(entry.userAgent), entry.name).toBe(false)
    }
  })

  it("has no empty or duplicate patterns", () => {
    const seen = new Set<string>()

    for (const pattern of BOT_PATTERNS) {
      expect(pattern).toBe(pattern.trim().toLowerCase())
      expect(pattern.length).toBeGreaterThan(1)
      expect(seen.has(pattern)).toBe(false)
      seen.add(pattern)
    }
  })
})
