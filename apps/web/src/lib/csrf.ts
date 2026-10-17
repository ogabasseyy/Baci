// CSRF Protection Utilities
// Implements Double Submit Cookie pattern for CSRF protection

import { type NextRequest, NextResponse } from 'next/server';
import {
  buildCsrfHeaders,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_NAMES,
  FALLBACK_CSRF_TOKEN_NAME,
  getClientCsrfToken,
  PRIMARY_CSRF_TOKEN_NAME,
} from './csrf-client';

const IS_PROD = process.env.NODE_ENV === 'production';

export { buildCsrfHeaders, CSRF_HEADER_NAME, getClientCsrfToken };

/**
 * Generate a cryptographically secure CSRF token using Web Crypto API
 */
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Set CSRF token in cookies (call this in server components/API routes)
 */
export async function setCsrfToken(): Promise<string> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const token = generateCsrfToken();

  // Store token in regular cookie (accessible to JavaScript)
  cookieStore.set(PRIMARY_CSRF_TOKEN_NAME, token, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });

  // Grace-period compatibility for in-flight sessions still reading legacy names.
  if (IS_PROD) {
    cookieStore.set(FALLBACK_CSRF_TOKEN_NAME, token, {
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });
  }

  return token;
}

/**
 * Get CSRF token from cookies (for client-side use)
 * Note: Does not automatically generate a new token to avoid cookie modification in Server Components
 */
export async function getCsrfToken(): Promise<string | null> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  for (const name of CSRF_TOKEN_NAMES) {
    const token = cookieStore.get(name);
    if (token?.value) {
      return token.value;
    }
  }
  return null;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses Web Crypto API (available in Node 18+ and all modern browsers).
 * HMAC-based: produces fixed-size digests regardless of input length,
 * so the XOR comparison loop is always constant-time.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode('csrf-compare'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ]);

  const viewA = new Uint8Array(macA);
  const viewB = new Uint8Array(macB);
  let result = 0;
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i];
  }
  return result === 0;
}

/**
 * Verify CSRF token from request (Edge-compatible - uses request.cookies)
 */
export async function verifyCsrfToken(request: NextRequest): Promise<boolean> {
  // Get token from header
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  if (!headerToken) {
    console.warn('CSRF: No token in header');
    return false;
  }

  // Get token from cookie using Edge-compatible request.cookies
  // TODO: Bind CSRF token to a server-side secret (HMAC) for stronger replay resistance.
  let cookieToken: string | null = null;
  for (const name of CSRF_TOKEN_NAMES) {
    const tokenCookie = request.cookies.get(name);
    if (tokenCookie?.value) {
      cookieToken = tokenCookie.value;
      break;
    }
  }

  if (!cookieToken) {
    console.warn('CSRF: Missing token cookie');
    return false;
  }

  // Verify header token matches cookie token (constant-time)
  return await timingSafeEqual(headerToken, cookieToken);
}

/**
 * Middleware to check CSRF token for state-changing requests
 */
export async function checkCsrfProtection(request: NextRequest): Promise<{
  valid: boolean;
  response?: NextResponse;
}> {
  const method = request.method;

  // Only check CSRF for state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return { valid: true };
  }

  // Skip CSRF for Bearer token auth (mobile apps).
  // CSRF exploits automatic cookie sending; Bearer tokens are not sent automatically.
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.match(/^bearer\s+.+$/i)) {
    return { valid: true };
  }

  // Skip CSRF check for certain endpoints (e.g., webhooks, public analytics)
  const pathname = request.nextUrl.pathname;
  // Use startsWith for directory-style routes, exact match for specific endpoints
  const skipPathPrefixes = ['/api/webhooks/', '/api/auth/'];
  const skipExactPaths = ['/api/platform/events']; // Public analytics endpoint

  if (
    skipPathPrefixes.some((path) => pathname.startsWith(path)) ||
    skipExactPaths.includes(pathname)
  ) {
    return { valid: true };
  }

  // Verify CSRF token
  const isValid = await verifyCsrfToken(request);

  if (!isValid) {
    const response = NextResponse.json(
      {
        error: 'Invalid CSRF token',
        message:
          'CSRF token validation failed. Please refresh the page and try again.',
      },
      { status: 403 }
    );

    return { valid: false, response };
  }

  return { valid: true };
}
