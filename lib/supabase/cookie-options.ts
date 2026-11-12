// Shared cookie options for the Supabase clients. The same values must be used
// by the browser client and the server client, otherwise the browser stores a
// session cookie the server will not send back.

export type SupabaseCookieOptions = {
  path: "/"
  sameSite: "lax"
  secure: boolean
  domain?: string
}

export function buildCookieOptions(input: {
  appEnv: string
  cookieDomain?: string
}): SupabaseCookieOptions {
  const options: SupabaseCookieOptions = {
    path: "/",
    sameSite: "lax",
    secure: input.appEnv === "production",
  }

  // An empty value means "this exact host", which is what vercel.app needs:
  // setting a domain there would stop the cookie being stored at all.
  if (typeof input.cookieDomain === "string" && input.cookieDomain.trim() !== "") {
    options.domain = input.cookieDomain
  }

  return options
}
