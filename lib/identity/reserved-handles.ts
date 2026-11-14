// Handles nobody may take.
//
// This list is the same as the one inside public.is_reserved_handle() in
// supabase/migrations/20261113000100_roles_onboarding.sql. The database is the
// authority: this copy exists so the form can say "that one is taken" before
// the request is sent, instead of after a round trip. A test reads the
// migration and fails if the two lists drift apart.

export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "administrator",
  "support",
  "help",
  "affilova",
  "api",
  "www",
  "app",
  "dashboard",
  "merchant",
  "account",
  "login",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "auth",
  "root",
  "system",
  "billing",
  "payments",
  "security",
  "staff",
  "moderator",
  "finance",
  "store",
  "shop",
  "blog",
  "about",
  "contact",
  "terms",
  "privacy",
  "status",
  "null",
  "undefined",
]

/** Matches public.is_reserved_handle(): trimmed and case-insensitive. */
export function isReservedHandle(value: string): boolean {
  return RESERVED_HANDLES.includes(value.trim().toLowerCase())
}
