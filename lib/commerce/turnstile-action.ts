// The Turnstile action name the checkout widget sends.
//
// It lives on its own so the widget (a client component) and the server-side
// verifier can be compared without either importing the other: the verifier is
// server-only, and the widget must never pull a server module into the browser
// bundle. tests/contracts/turnstile.contract.test.ts asserts that this name is
// the one lib/security/turnstile-verify.ts requires, so the two cannot drift.
export const CHECKOUT_TURNSTILE_ACTION = "checkout"
