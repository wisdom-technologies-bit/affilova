import { getPublicEnv } from "@/lib/env"
import { hostMapFromEnv, type AppName } from "@/lib/hosts"

// Absolute URLs for the app's hosts, used where a link has to leave the request
// it was created on: the redirect links in Supabase auth emails, the OAuth
// callback and the post-sign-in redirect.
//
// Resolution order for a path:
//   1. the host configured for that app          -> https://<host><path>
//   2. in development, when no host is configured -> http://localhost:3000<path>
//   3. the public host                           -> https://<public host><path>
//   4. NEXT_PUBLIC_APP_URL, the canonical URL     -> <canonical><path>
//
// Hosts come from hostMapFromEnv() so this stays in step with the routing in
// middleware.ts. Everything else is read through lib/env.ts.

const LOCAL_APP_URL = "http://localhost:3000"

export function appUrl(app: AppName, path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`appUrl: path must start with "/", received ${JSON.stringify(path)}`)
  }

  const hosts = hostMapFromEnv()
  const host = hosts[app]

  if (host !== undefined) {
    return `https://${host}${path}`
  }

  const env = getPublicEnv()

  if (env.NEXT_PUBLIC_APP_ENV === "development") {
    return `${LOCAL_APP_URL}${path}`
  }

  if (hosts.public !== undefined) {
    return `https://${hosts.public}${path}`
  }

  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}${path}`
}
