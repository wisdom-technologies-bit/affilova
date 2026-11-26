import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  APP_OVERRIDE_COOKIE,
  resolveAppOverride,
  resolveRoute,
} from "@/lib/host-routing"
import { APP_HEADER, appForHost, hostMapFromEnv, type AppName } from "@/lib/hosts"

/**
 * The path a visitor asked for, carried to the server components.
 *
 * The app hosts rewrite "/products" to "/hosts/merchant/products", so the
 * rewritten request no longer knows the address the browser shows. This header
 * carries the original pathname and its query string, and lib/current-app.ts
 * reads it. The name is repeated there, which is the only place the two must
 * agree.
 */
export const PATH_HEADER = "x-affilova-path"

export function middleware(request: NextRequest) {
  // Resolve which app this request belongs to and pass it down as a request
  // header. This file does nothing else: no session is read here. Who may see
  // what is decided by the layouts and server actions of each app.
  let app: AppName = "public"

  try {
    app = appForHost({
      host: request.headers.get("host"),
      hosts: hostMapFromEnv(),
      appEnv: process.env.NEXT_PUBLIC_APP_ENV,
      override: request.nextUrl.searchParams.get("app"),
    })
  } catch {
    app = "public"
  }

  // Preview builds only: ?app= leaves a cookie behind, and the cookie stands in
  // for the parameter on the pages that follow. In production this decides
  // nothing and sets nothing.
  const override = resolveAppOverride({
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
    queryValue: request.nextUrl.searchParams.get("app"),
    cookieValue: request.cookies.get(APP_OVERRIDE_COOKIE)?.value ?? null,
  })

  if (override.app !== null) {
    app = override.app
  }

  const { pathname, search } = request.nextUrl

  // Rebuild the headers so a client cannot spoof the app by sending its own
  // x-affilova-app header.
  const headers = new Headers(request.headers)
  headers.delete(APP_HEADER)
  headers.set(APP_HEADER, app)

  // The path the visitor asked for, before any rewrite. An app host serves
  // /products out of /hosts/merchant/products, and the layout needs the visible
  // path to send a signed-out visitor back to it. The incoming header is deleted
  // on every host, and only an app host gets a value, so it cannot be spoofed on
  // the public site either.
  headers.delete(PATH_HEADER)

  if (app !== "public") {
    headers.set(PATH_HEADER, `${pathname}${search}`)
  }

  // Every response below leaves through here, so the preview cookie is set on
  // a redirect and on a rewrite alike.
  const respond = (response: NextResponse): NextResponse => {
    if (override.setCookie !== null) {
      response.cookies.set({
        name: APP_OVERRIDE_COOKIE,
        value: override.setCookie,
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      })
    }

    return response
  }

  const route = resolveRoute({ app, pathname, search })

  // /hosts/* is the internal tree: it is reached by rewrite, never by a URL.
  if (route.kind === "not-found") {
    return respond(
      new NextResponse("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    )
  }

  if (route.kind === "rewrite") {
    return respond(NextResponse.rewrite(new URL(route.to, request.url), { request: { headers } }))
  }

  return respond(NextResponse.next({ request: { headers } }))
}

export const config = {
  // Every path except the build output, the favicon and files with an asset
  // extension. The extensions are the ones in ASSET_EXTENSIONS
  // (lib/host-routing.ts): Next.js only reads this matcher as a literal, so the
  // two lists are kept in step by hand. classifyPath, not the matcher, is what
  // decides whether a path is a file.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:avif|css|eot|gif|ico|jpe?g|js|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|ttf|wav|webmanifest|webm|woff2?)$).*)",
  ],
}
