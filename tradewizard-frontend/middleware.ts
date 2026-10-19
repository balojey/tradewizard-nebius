import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Protected route prefixes. Any path starting with one of these
 * requires an authenticated user (valid tw_id_token cookie).
 */
const PROTECTED_PREFIXES = [
  '/markets',
  '/insights',
  '/portfolio',
  '/portfolio-manager',
  '/account',
]

/**
 * Check if a path is protected (requires authentication).
 */
function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * Check if the user is authenticated by reading the tw_id_token cookie.
 * Only checks presence and unexpired exp claim - no cryptographic validation.
 */
function isAuthenticated(request: NextRequest): boolean {
  const token = request.cookies.get('tw_id_token')?.value
  if (!token) return false

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false

    // Decode JWT payload (base64url → JSON)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    )

    // Check exp claim exists and is not expired
    if (typeof payload.exp !== 'number') return false
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const authed = isAuthenticated(request)

  // Authenticated user at / → redirect to /markets
  if (pathname === '/' && authed) {
    return NextResponse.redirect(new URL('/markets', request.url), 307)
  }

  // Unauthenticated user at protected route → redirect to /login?next=<path>
  if (isProtectedPath(pathname) && !authed) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl, 307)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - Files with extensions (static assets like .png, .svg, .css, .js)
     * - /api/* routes (handled by Next.js API routes)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api/|.*\\..*).*)',
  ],
}
