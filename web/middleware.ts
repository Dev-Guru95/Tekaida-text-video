/**
 * Next.js middleware entry point. Forwards every request through the
 * Supabase session-refresh helper so auth cookies are kept fresh across
 * navigations between `/`, `/build`, and any API route.
 *
 * The matcher excludes static assets and image-optimization paths — there's
 * no point running auth logic on a CSS chunk or a favicon, and including
 * them would tank cache hit rates.
 */

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match everything EXCEPT:
     *  - _next/static  (build output)
     *  - _next/image   (image optimizer)
     *  - favicon.ico
     *  - file extensions for static assets (svg/png/jpg/etc)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
