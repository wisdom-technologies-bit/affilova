/** @type {import('next').NextConfig} */

// Playbook for this file
// ======================
//
// 1. The five transport and browser-hardening headers below are enforced today.
//    They are plain, static values, so they are set here rather than in
//    middleware.ts (which only matches a handful of paths).
//
// 2. The Content-Security-Policy is deliberately **Report-Only**: the browser
//    sends violations to /api/csp-report and blocks nothing. Report-Only is
//    switched to enforcing only after two weeks of clean reports from
//    production traffic (the dashboard for them is the console line that
//    /api/csp-report writes).
//
// 3. A strict, nonce-based policy (no 'unsafe-inline', a nonce on every script)
//    is deferred until after launch. A per-request nonce can only be generated
//    in middleware for a dynamically rendered response, so adopting it forces
//    every page, including the static marketing pages, to render dynamically.
//    That is a performance and hosting-cost decision, not a header decision, so
//    it is revisited once the site is live and the Report-Only data shows what
//    is actually needed.
//
// 4. Every origin in the policy has to be justified by code that is really in
//    the repository. The list was built by grepping app/, components/, lib/,
//    hooks/ and styles/ for external URLs:
//
//      script-src   https://challenges.cloudflare.com  Turnstile widget script.
//                   app/auth/login/login-client.tsx, app/auth/register/
//                   _components/RegisterClient.tsx, lib/identity/turnstile.ts
//      script-src   https://checkout.squadco.com      Legacy Squad checkout
//                   widget. components/squad-payment.tsx (used by
//                   app/products/[id]/purchase and app/dashboard/vendor/store)
//      frame-src    https://challenges.cloudflare.com Turnstile renders in an
//                   iframe.
//      frame-src    https://popup.squadco.com         The Squad widget builds an
//                   iframe pointed at this origin (read from
//                   https://checkout.squadco.com/widget/squad.min.js).
//      connect-src  https://*.supabase.co,
//                   wss://*.supabase.co              Supabase auth client.
//                   lib/supabase/browser.ts
//      connect-src  https://challenges.cloudflare.com Turnstile's own requests.
//      img-src      https://res.cloudinary.com        Uploaded product, blog and
//                   avatar images. lib/cloudinary.ts returns Cloudinary
//                   secure_url values, which are rendered in <img>.
//      img-src      https://lh3.googleusercontent.com Google account avatars.
//                   profile_picture_url is filled from Google's `picture` claim
//                   in app/api/auth/google/callback/route.ts.
//
//    Origins that are **not** in the policy, and why:
//
//      https://va.vercel-scripts.com, https://vitals.vercel-insights.com
//        @vercel/analytics is installed but no <Analytics /> or speed insights
//        component is rendered anywhere, so nothing loads from those hosts.
//        Add them back the moment such a component is added.
//      https://js.paystack.co, https://checkout.paystack.com,
//        https://api.paystack.co
//        There is no Paystack code yet: the keys are optional placeholders in
//        lib/env.ts and the flow is still Squad. Nothing requests those hosts.
//      https://api.pwnedpasswords.com
//        The breach check runs on the server only (lib/identity/password.ts,
//        called from the "use server" actions), so the browser never fetches it
//        and connect-src is not what governs that call.
//
//    Server-to-server calls are not covered by CSP at all: lib/brevo.ts
//    (api.brevo.com), lib/google-auth.ts and app/api/auth/google/callback
//    (oauth2.googleapis.com, accounts.google.com) and lib/squad.ts
//    (api-d.squadco.com) never run in the page.
//
// 5. Known gaps the Report-Only phase is expected to surface, recorded here so
//    nobody mistakes a report for a regression:
//    - form-action 'self' and the Squad widget's 3-D Secure step, which posts a
//      form to the issuing bank's own ACS origin (an unenumerable set of hosts).
//    - Vendor-authored blog and sales-page HTML is rendered with
//      dangerouslySetInnerHTML, so it can reference images or embeds from any
//      origin an author typed.

// The endpoint that receives violations. POST only, 8 KB cap, no storage: see
// app/api/csp-report/route.ts.
const CSP_REPORT_URI = "/api/csp-report"

const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // 'unsafe-inline' is required while there is no per-request nonce; the
  // nonce-based policy described above replaces it.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://checkout.squadco.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://popup.squadco.com",
  `report-uri ${CSP_REPORT_URI}`,
].join("; ")

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicyReportOnly,
  },
]

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Every route, including the API handlers and static assets.
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
