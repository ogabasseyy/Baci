/**
 * Ogabassey ChatGPT MCP Server
 *
 * Production-ready MCP server following 2025 security best practices:
 * - Rate limiting per IP
 * - Input validation & sanitization
 * - Audit logging
 * - Proper error handling (fail closed)
 * - Security headers
 * - Request size limits
 *
 * Run with: npx tsx mcp-server/server.ts
 */

import { randomUUID } from 'node:crypto';
import { prepareCartHandoff } from './cart-handoff';
import * as fs from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { isIP } from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import 'dotenv/config';
import { normalizeOgabasseyCdnImageUrl } from '../src/lib/ogabassey-cdn-image-url';
import {
  AGENTIC_CHECKOUT_AGENT_ID,
  type AgenticCheckoutClientConfig,
  type AgenticCheckoutSessionRequestResult,
  cancelAgenticCheckoutSession,
  cancelAgenticCheckoutSessionInputSchema,
  completeAgenticCheckoutSession,
  completeAgenticCheckoutSessionInputSchema,
  createAgenticCheckoutSession,
  createAgenticCheckoutSessionMcpInputSchema,
  getAgenticCheckoutSession,
  getAgenticCheckoutSessionInputSchema,
  updateAgenticCheckoutSession,
  updateAgenticCheckoutSessionMcpInputSchema,
} from './agentic-checkout-client';
import { resolveMcpPaystackDvaAccess } from './mcp-paystack-dva-access';
import { registerAgenticUcpTools } from './agentic-ucp-tools';
import { resolveMcpSearchProductCondition } from './product-condition-filter';
import { loadMcpSearchProducts } from './search-products-query';
import { getMcpOfferAvailability, getMcpProductStockSummary } from './product-stock-summary';
import { serveProductImage } from './product-image-proxy';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { checkProductImageRateLimit } from './product-image-rate-limit';
import { selectRecommendedProducts } from './recommendation-products';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OGABASSEY_SLUG = 'ogabassey';
const PORT = Number(process.env.MCP_PORT ?? 8787);
const MCP_PATH = '/mcp';
const MCP_PUBLIC_ORIGIN = new URL(process.env.MCP_PUBLIC_ORIGIN?.trim() || 'https://mcp.ogabassey.com').origin;
const MCP_ALLOWED_HEADERS = 'content-type, mcp-protocol-version, mcp-session-id';
const MCP_ALLOWED_METHODS = 'POST, GET, OPTIONS, DELETE, HEAD';
const AGENTIC_CHECKOUT_TOOLS_ENABLED =
  process.env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS === '1' ||
  process.env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS === 'true';
// These legacy tools accept buyer identifiers without authentication. Keep them
// unavailable until they are rebuilt on an authorized customer session.
const ORDER_PAYMENT_TOOLS_ENABLED = false;
const AGENTIC_CHECKOUT_API_BASE_URL =
  process.env.MCP_AGENTIC_CHECKOUT_BASE_URL ?? 'https://ogabassey.com';
const AGENTIC_CHECKOUT_API_KEY = getAgenticCredential(
  'BACI_AGENTIC_ACCESS_TOKEN',
  'OPENAI_AGENTIC_API_KEY'
);
const AGENTIC_CHECKOUT_SIGNING_KEY = getAgenticCredential(
  'BACI_AGENTIC_SIGNING_KEY',
  'OPENAI_AGENTIC_SIGNING_KEY'
);

type ConfiguredAgenticCheckoutClientConfig = AgenticCheckoutClientConfig & {
  apiKey: string;
  signingKey: string;
};



function getAgenticCredential(primaryName: string, legacyName: string) {
  const primary = process.env[primaryName]?.trim();
  if (primary) return primary;

  const legacy = process.env[legacyName]?.trim();
  return legacy || undefined;
}

function getAgenticCheckoutClientConfig():
  | ConfiguredAgenticCheckoutClientConfig
  | null {
  if (!AGENTIC_CHECKOUT_TOOLS_ENABLED) {
    return null;
  }

  if (!AGENTIC_CHECKOUT_API_KEY || !AGENTIC_CHECKOUT_SIGNING_KEY) {
    return null;
  }

  return {
    agentId: AGENTIC_CHECKOUT_AGENT_ID,
    apiBaseUrl: AGENTIC_CHECKOUT_API_BASE_URL,
    apiKey: AGENTIC_CHECKOUT_API_KEY,
    signingKey: AGENTIC_CHECKOUT_SIGNING_KEY,
  };
}

function buildAgenticCheckoutErrorResponse({
  action,
  result,
}: {
  action: string;
  result: Extract<AgenticCheckoutSessionRequestResult, { ok: false }>;
}) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `❌ Unable to ${action}: ${result.error}`,
      },
    ],
    structuredContent: {
      details: result.details ?? null,
      endpoint: result.endpoint ?? null,
      error: result.error,
      idempotency_key: result.idempotencyKey ?? null,
      request_id: result.requestId ?? null,
      status: 'error',
      status_code: result.status,
    },
  };
}

function getCheckoutSessionField(response: unknown, field: string) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return undefined;
  }

  const value = Object.getOwnPropertyDescriptor(response, field)?.value;
  return typeof value === 'string' ? value : undefined;
}

// Security settings
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP
const RATE_LIMIT_MAX_ENTRIES = 10_000; // Max unique IPs to track (prevent memory exhaustion)

const REQUEST_TIMEOUT_MS = 30_000; // 30 second timeout

const productLookupInputSchema = {
  product_id: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Product ID from a prior search_products result'),
  product_name: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Exact product name from the catalog; call search_products first when unsure'
    ),
};

// Validate required environment variables at startup (fail closed)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('FATAL: Missing required environment variables');
  console.error(
    'Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
  process.exit(1);
}

// Public shopping tools use the normal RLS-scoped anonymous client.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function getClientIP(req: IncomingMessage): string {
  // Trust a forwarded client address only when the operator has verified that
  // the private reverse proxy overwrites this header on every request.
  const realIp = req.headers['x-real-ip'];
  if (process.env.MCP_TRUST_PROXY_REAL_IP === 'true' && typeof realIp === 'string' && isIP(realIp.trim()) > 0) {
    return realIp.trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    // Check if we're at capacity - if so, clean expired entries first
    if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      // Emergency cleanup: remove all expired entries
      for (const [existingIp, existingEntry] of rateLimitMap.entries()) {
        if (now > existingEntry.resetAt) {
          rateLimitMap.delete(existingIp);
        }
      }
      // If still at capacity after cleanup, reject new IPs (DDoS protection)
      if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
        console.warn(
          JSON.stringify({
            type: 'security',
            event: 'rate_limit_capacity',
            ip: ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.xxx.xxx'),
          })
        );
        return {
          allowed: false,
          remaining: 0,
          resetAt: now + RATE_LIMIT_WINDOW_MS,
        };
      }
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetAt: entry.resetAt,
  };
}

// Cleanup old rate limit entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(ip);
      }
    }
  },
  5 * 60 * 1000
);

// =============================================================================
// AUDIT LOGGING
// =============================================================================

interface AuditLogEntry {
  timestamp: string;
  requestId: string;
  ip: string;
  method: string;
  path: string;
  tool?: string;
  statusCode: number;
  durationMs: number;
  error?: string;
}

function logAudit(entry: AuditLogEntry): void {
  // Redact sensitive data, log structured JSON for easy parsing
  const sanitized = {
    ...entry,
    ip: entry.ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.xxx.xxx'), // Partial IP for privacy
  };
  console.log(JSON.stringify({ type: 'audit', ...sanitized }));
}

function logError(requestId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // Never log stack traces in production (could leak sensitive info)
  console.error(
    JSON.stringify({
      type: 'error',
      requestId,
      message,
      timestamp: new Date().toISOString(),
    })
  );
}

// =============================================================================
// INPUT VALIDATION & SANITIZATION
// =============================================================================

// Sanitize string input to prevent injection attacks
function sanitizeString(input: string, maxLength = 200): string {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/[\x00-\x1f]/g, '') // Remove null bytes and control characters
    .replace(/[<>"'`\\;]/g, '') // Remove potentially dangerous chars including semicolons and backslashes
    .trim();
}

// Validate and sanitize price input
function sanitizePrice(price: unknown): number | undefined {
  if (typeof price !== 'number') return undefined;
  if (price < 0 || price > 1_000_000_000) return undefined; // Max 1 billion NGN
  return Math.floor(price);
}

// Validate order number format
function isValidOrderNumber(orderNumber: string): boolean {
  // Expected format: ORD-XXXXX or similar
  return /^[A-Z0-9-]{3,20}$/i.test(orderNumber);
}

// Validate phone number format (basic)
function isValidPhone(phone: string): boolean {
  return /^[0-9+\-\s]{7,20}$/.test(phone);
}

// =============================================================================
// SECURITY HEADERS
// =============================================================================

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

let cachedMerchantId: string | null = null;
let merchantIdCacheTime = 0;
const MERCHANT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getMerchantId(): Promise<string | null> {
  const now = Date.now();
  if (cachedMerchantId && now - merchantIdCacheTime < MERCHANT_CACHE_TTL) {
    return cachedMerchantId;
  }

  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', OGABASSEY_SLUG)
      .single();

    if (error) {
      console.error(
        JSON.stringify({
          type: 'error',
          context: 'getMerchantId',
          message: error.message,
        })
      );
      // On error, invalidate cache and return null
      cachedMerchantId = null;
      return null;
    }

    cachedMerchantId = data?.id || null;
    merchantIdCacheTime = now;
    return cachedMerchantId;
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'error',
        context: 'getMerchantId',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    );
    cachedMerchantId = null;
    return null;
  }
}

const NGN_PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
});

function formatPrice(price: number): string {
  return NGN_PRICE_FORMATTER.format(price);
}

/** Serve catalog images from our MCP origin because the store CDN blocks
 * requests with ChatGPT's sandbox origin as their referrer. */
function getSafeCatalogImageUrl(
  imageUrl: string | null | undefined
): string | undefined {
  if (typeof imageUrl !== 'string' || !imageUrl) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(normalizeOgabasseyCdnImageUrl(imageUrl), 'https://cdn.ogabassey.com');
  } catch {
    return undefined;
  }
  // Only store CDN product assets may be proxied to the widget.
  if (parsed.origin !== 'https://cdn.ogabassey.com') return undefined;
  // Fix path mismatch: database stores /products/ but CDN serves from /core-assets/products/
  if (parsed.pathname.includes('/products/') && !parsed.pathname.includes('/core-assets/products/')) {
    parsed.pathname = parsed.pathname.replace('/products/', '/core-assets/products/');
  }
  if (!parsed.pathname.startsWith('/core-assets/products/')) return undefined;
  return `${MCP_PUBLIC_ORIGIN}/images${parsed.pathname}${parsed.search}`;
}

// =============================================================================
// WIDGET HTML (CSP-compliant, no inline event handlers in production)
// =============================================================================

const widgetHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; font-src https://fonts.gstatic.com;" />
  <title>Ogabassey Store</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {
      --bg-base: #050505;
      --bg-primary: #0a0a0a;
      --bg-glass: rgba(255, 255, 255, 0.03);
      --bg-glass-hover: rgba(255, 255, 255, 0.06);
      --accent: #ef4444;
      --accent-glow: rgba(239, 68, 68, 0.3);
      --gold: #ffd700;
      --gold-glow: rgba(255, 215, 0, 0.2);
      --text-primary: #ffffff;
      --text-secondary: #a1a1aa;
      --text-muted: #52525b;
      --border-glass: rgba(255, 255, 255, 0.08);
      --success: #10b981;
      --info: #3b82f6;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100%;
      min-height: 100%;
      font-family: "Inter", system-ui, sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
    }

    /* Snowfall effect */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image:
        radial-gradient(2px 2px at 20px 30px, rgba(255,255,255,0.3), transparent),
        radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.2), transparent),
        radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.3), transparent),
        radial-gradient(2px 2px at 130px 80px, rgba(255,255,255,0.2), transparent),
        radial-gradient(1px 1px at 160px 120px, rgba(255,255,255,0.4), transparent),
        radial-gradient(2px 2px at 200px 50px, rgba(255,255,255,0.2), transparent),
        radial-gradient(1px 1px at 250px 90px, rgba(255,255,255,0.3), transparent),
        radial-gradient(2px 2px at 300px 130px, rgba(255,255,255,0.2), transparent),
        radial-gradient(1px 1px at 350px 20px, rgba(255,255,255,0.4), transparent),
        radial-gradient(2px 2px at 380px 100px, rgba(255,255,255,0.2), transparent);
      background-size: 400px 200px;
      animation: snow 8s linear infinite;
      pointer-events: none;
      z-index: 0;
      opacity: 0.6;
    }

    @keyframes snow {
      0% { background-position: 0 0; }
      100% { background-position: 400px 200px; }
    }

    main {
      max-width: 420px;
      margin: 0 auto;
      padding: 16px;
      position: relative;
      z-index: 1;
    }

    /* Glassmorphism Header */
    .header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
      padding: 16px 18px;
      background: var(--bg-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      border: 1px solid var(--border-glass);
      position: relative;
      overflow: hidden;
    }

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
    }

    .logo {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--accent) 0%, #b91c1c 100%);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 13px;
      color: white;
      letter-spacing: -0.5px;
      box-shadow: 0 8px 32px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.2);
      position: relative;
    }

    .logo::after {
      content: '🎄';
      position: absolute;
      top: -6px;
      right: -6px;
      font-size: 14px;
    }

    .brand-info h1 {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.3px;
      line-height: 1.2;
    }

    .brand-info .subtitle {
      color: var(--text-secondary);
      font-size: 0.72rem;
      margin-top: 3px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .verified-badge {
      width: 14px;
      height: 14px;
      background: linear-gradient(135deg, var(--info) 0%, #2563eb 100%);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }

    .verified-badge svg { width: 8px; height: 8px; stroke: white; stroke-width: 3; }

    /* Quick Actions Grid */
    .welcome-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }

    .quick-action {
      background: var(--bg-glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border-glass);
      border-radius: 16px;
      padding: 16px 10px 14px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .quick-action::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
      opacity: 0;
      transition: opacity 0.3s;
    }

    .quick-action:hover {
      background: var(--bg-glass-hover);
      border-color: rgba(239, 68, 68, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px rgba(239,68,68,0.1);
    }

    .quick-action:hover::before { opacity: 1; }

    .quick-action-icon {
      font-size: 24px;
      margin-bottom: 6px;
      display: block;
    }

    .quick-action-text {
      font-size: 0.7rem;
      color: var(--text-secondary);
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: -0.2px;
    }

    /* Santa Special Button */
    .santa-action {
      background: linear-gradient(135deg, rgba(26, 71, 42, 0.8) 0%, rgba(45, 90, 61, 0.8) 100%);
      border: 1px solid rgba(196, 30, 58, 0.5);
      animation: santaGlow 2s ease-in-out infinite alternate;
    }

    @keyframes santaGlow {
      0% { box-shadow: 0 0 20px rgba(196, 30, 58, 0.2); }
      100% { box-shadow: 0 0 30px rgba(196, 30, 58, 0.4), 0 0 60px rgba(255, 215, 0, 0.1); }
    }

    .santa-action:hover {
      background: linear-gradient(135deg, rgba(45, 90, 61, 0.9) 0%, rgba(61, 111, 77, 0.9) 100%);
      border-color: rgba(255, 77, 106, 0.6);
    }

    .santa-action .quick-action-text {
      color: var(--gold);
      text-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
    }

    .santa-action .quick-action-icon {
      animation: bounce 1s ease-in-out infinite;
    }

    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }

    /* CTA Section */
    .cta-section {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.9) 0%, rgba(185, 28, 28, 0.9) 100%);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      padding: 24px 20px;
      text-align: center;
      color: white;
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .cta-section::before {
      content: '';
      position: absolute;
      top: -100%;
      right: -100%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.15) 0%, transparent 50%);
      pointer-events: none;
    }

    .cta-section::after {
      content: '🎁';
      position: absolute;
      top: 12px;
      right: 16px;
      font-size: 20px;
      opacity: 0.8;
    }

    .cta-section h3 {
      margin: 0 0 8px;
      font-size: 1.1rem;
      font-weight: 700;
      position: relative;
      letter-spacing: -0.3px;
    }

    .cta-section p {
      margin: 0 0 16px;
      font-size: 0.82rem;
      opacity: 0.9;
      font-weight: 400;
      position: relative;
    }

    .cta-btn {
      background: white;
      color: var(--accent);
      border: none;
      padding: 12px 28px;
      border-radius: 12px;
      font-weight: 700;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      position: relative;
    }

    .cta-btn:hover {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 12px 32px rgba(0,0,0,0.3);
    }

    /* Product Grid */
    .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }

    .product-card {
      background: var(--bg-glass);
      backdrop-filter: blur(12px);
      border-radius: 18px;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid var(--border-glass);
      position: relative;
    }

    .product-card:hover {
      background: var(--bg-glass-hover);
      border-color: rgba(255,255,255,0.12);
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }

    .product-img-wrap {
      position: relative;
      background: linear-gradient(180deg, rgba(38,38,38,0.5) 0%, rgba(26,26,26,0.5) 100%);
      padding: 14px;
      cursor: pointer;
    }

    .product-img {
      width: 100%;
      height: 85px;
      object-fit: contain;
      display: block;
      transition: transform 0.3s ease;
    }

    .product-card:hover .product-img { transform: scale(1.08); }

    .product-badges { position: absolute; top: 10px; left: 10px; display: flex; flex-direction: column; gap: 4px; }

    .badge {
      font-size: 0.6rem;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      backdrop-filter: blur(8px);
    }

    .badge-sale {
      background: linear-gradient(135deg, var(--accent), #dc2626);
      color: white;
      box-shadow: 0 2px 8px var(--accent-glow);
    }

    .badge-condition {
      background: rgba(59, 130, 246, 0.9);
      color: white;
    }

    .product-info { padding: 12px 14px 14px; }

    .product-name {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 6px;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      cursor: pointer;
      transition: color 0.2s;
    }

    .product-name:hover { color: var(--accent); }

    .product-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }

    .product-brand { font-size: 0.65rem; color: var(--text-muted); font-weight: 500; }

    .in-stock {
      font-size: 0.6rem;
      color: var(--success);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .in-stock::before {
      content: '';
      width: 6px;
      height: 6px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
    }

    .price-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }

    .product-price { font-size: 0.95rem; color: var(--text-primary); font-weight: 700; }

    .original-price { font-size: 0.72rem; color: var(--text-muted); text-decoration: line-through; }

    .product-actions { display: flex; gap: 8px; }

    .btn {
      flex: 1;
      border: none;
      padding: 10px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }

    .btn-cart {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border-glass);
      color: var(--text-primary);
    }

    .btn-cart:hover {
      background: rgba(255,255,255,0.1);
      border-color: var(--accent);
      color: var(--accent);
    }

    .btn-buy {
      background: linear-gradient(135deg, var(--accent) 0%, #dc2626 100%);
      color: white;
      box-shadow: 0 4px 16px var(--accent-glow);
    }

    .btn-buy:hover {
      transform: scale(1.03);
      box-shadow: 0 6px 24px var(--accent-glow);
    }

    /* Order Status */
    .order-card {
      background: var(--bg-glass);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-glass);
      border-radius: 20px;
      padding: 18px;
      margin-bottom: 16px;
    }

    .order-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border-glass);
    }

    .order-title { display: flex; align-items: center; gap: 10px; }

    .order-icon {
      width: 40px;
      height: 40px;
      background: var(--bg-glass);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .order-number { font-weight: 700; font-size: 0.95rem; color: var(--text-primary); }

    .order-date { font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; }

    .status-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 20px;
      text-transform: capitalize;
    }

    .status-badge.pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .status-badge.processing { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .status-badge.shipped { background: rgba(59, 130, 246, 0.15); color: var(--info); }
    .status-badge.delivered { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .status-badge.cancelled { background: rgba(239, 68, 68, 0.15); color: var(--accent); }

    .order-total {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px;
      background: var(--bg-glass);
      border-radius: 12px;
    }

    .order-total-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }

    .order-total-value { font-size: 1.05rem; color: var(--text-primary); font-weight: 700; }

    /* Empty State */
    .empty-state { text-align: center; padding: 48px 24px; }

    .empty-icon {
      width: 64px;
      height: 64px;
      background: var(--bg-glass);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 18px;
    }

    .empty-icon svg { width: 32px; height: 32px; stroke: var(--text-muted); }

    .empty-state p { color: var(--text-muted); font-size: 0.9rem; }
  </style>
</head>
<body>
  <main id="app">
    <div class="header">
      <div class="logo">OGA</div>
      <div class="brand-info">
        <h1>Ogabassey</h1>
        <p class="subtitle">
          <span class="verified-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
          Premium Tech Store
        </p>
      </div>
    </div>
    <div id="content">
      <div class="welcome-grid">
        <div class="quick-action" id="qa-phones"><div class="quick-action-icon">📱</div><div class="quick-action-text">Phones</div></div>
        <div class="quick-action" id="qa-laptops"><div class="quick-action-icon">💻</div><div class="quick-action-text">Laptops</div></div>
        <div class="quick-action" id="qa-gaming"><div class="quick-action-icon">🎮</div><div class="quick-action-text">Gaming</div></div>
        <div class="quick-action" id="qa-deals"><div class="quick-action-icon">🔥</div><div class="quick-action-text">Hot Deals</div></div>
        <div class="quick-action" id="qa-repairs"><div class="quick-action-icon">🔧</div><div class="quick-action-text">Repairs</div></div>
        <div class="quick-action santa-action" id="qa-santa"><div class="quick-action-icon">🎅</div><div class="quick-action-text">Ask Santa!</div></div>
      </div>
      <div class="cta-section">
        <h3>🎄 Holiday Shopping Made Easy</h3>
        <p>Find the perfect gift - just ask me anything!</p>
        <button class="cta-btn" id="visit-btn">Explore Store</button>
      </div>
    </div>
  </main>
  <script type="module">
    const contentEl = document.getElementById('content');
    const visitBtn = document.getElementById('visit-btn');
    if (visitBtn) visitBtn.addEventListener('click', () => window.openai?.openExternal?.({ href: 'https://ogabassey.com' }) || window.open('https://ogabassey.com', '_blank'));

    // Quick actions
    document.getElementById('qa-phones')?.addEventListener('click', () => window.openai?.openExternal?.({ href: 'https://ogabassey.com/ogabassey/phones' }) || window.open('https://ogabassey.com/ogabassey/phones', '_blank'));
    document.getElementById('qa-laptops')?.addEventListener('click', () => window.openai?.openExternal?.({ href: 'https://ogabassey.com/ogabassey/laptops' }) || window.open('https://ogabassey.com/ogabassey/laptops', '_blank'));
    document.getElementById('qa-gaming')?.addEventListener('click', () => window.openai?.openExternal?.({ href: 'https://ogabassey.com/ogabassey/gaming' }) || window.open('https://ogabassey.com/ogabassey/gaming', '_blank'));
    document.getElementById('qa-deals')?.addEventListener('click', () => window.openai?.openExternal?.({ href: 'https://ogabassey.com' }) || window.open('https://ogabassey.com', '_blank'));
    document.getElementById('qa-repairs')?.addEventListener('click', () => window.openai?.openExternal?.({ href: 'https://ogabassey.com/ogabassey/repairs' }) || window.open('https://ogabassey.com/ogabassey/repairs', '_blank'));
    document.getElementById('qa-santa')?.addEventListener('click', () => {
      // Show festive Santa prompt
      contentEl.innerHTML = '<div style="text-align:center;padding:28px 20px;"><div style="font-size:56px;margin-bottom:16px;animation:bounce 1s ease-in-out infinite;">🎅</div><h3 style="color:#ffd700;margin-bottom:10px;font-size:1.2rem;text-shadow:0 0 20px rgba(255,215,0,0.3);">Ho Ho Ho!</h3><p style="color:#a1a1aa;font-size:0.88rem;margin-bottom:20px;line-height:1.5;">Type in the chat below to talk to Santa!<br><em style="color:#71717a;">Try: "Santa, find a gift for my mom"</em></p><div style="background:linear-gradient(135deg,rgba(26,71,42,0.9),rgba(45,90,61,0.9));border:1px solid rgba(196,30,58,0.5);border-radius:16px;padding:16px;backdrop-filter:blur(12px);"><p style="color:#fff;font-size:0.8rem;margin:0 0 8px;font-weight:600;">🎄 Santa can help with:</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;"><span style="background:rgba(255,255,255,0.1);padding:4px 10px;border-radius:20px;font-size:0.7rem;color:#a1a1aa;">🎁 Gift ideas</span><span style="background:rgba(255,255,255,0.1);padding:4px 10px;border-radius:20px;font-size:0.7rem;color:#a1a1aa;">🔥 Deals</span><span style="background:rgba(255,255,255,0.1);padding:4px 10px;border-radius:20px;font-size:0.7rem;color:#a1a1aa;">💰 Budget</span></div></div></div>';
    });

    const formatPrice = (price) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(price);

    const ESCAPE_HTML_MAP = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    // Attribute-safe escaping: product data below is interpolated into innerHTML attributes.
    const escapeHtml = (value) =>
      String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_HTML_MAP[char]);

    const openLink = (url) => window.openai?.openExternal?.({ href: url }) || window.open(url, '_blank');
    const productUrl = (slug) => 'https://ogabassey.com/products/' + encodeURIComponent(slug);
    const cartUrl = (productId) => 'https://ogabassey.com/cart?item_id=' + encodeURIComponent(productId);

    const renderProducts = (products) => {
      if (!products?.length) {
        contentEl.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg></div><p>No products found</p></div>';
        return;
      }
      const grid = products.slice(0, 4).map(p => {
        const card = document.createElement('div');
        card.className = 'product-card';
        const hasDiscount = p.compare_at_price && p.compare_at_price > p.price;
        const discountPct = hasDiscount ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0;
        const condition = p.condition && p.condition !== 'new' ? p.condition : null;
        const cartIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

        let badgesHtml = '<div class="product-badges">';
        if (hasDiscount) badgesHtml += '<span class="badge badge-sale">-' + discountPct + '%</span>';
        if (condition) badgesHtml += '<span class="badge badge-condition">' + escapeHtml(condition) + '</span>';
        badgesHtml += '</div>';

        card.innerHTML =
          '<div class="product-img-wrap">' +
            badgesHtml +
            '<img class="product-img" src="' + escapeHtml(p.image || 'https://placehold.co/200x200/1a1a1a/666?text=No+Image') + '" alt="" loading="lazy" />' +
          '</div>' +
          '<div class="product-info">' +
            '<p class="product-name">' + escapeHtml(p.name) + '</p>' +
            '<div class="product-meta">' +
              (p.brand ? '<span class="product-brand">' + escapeHtml(p.brand) + '</span>' : '') +
              '<span class="in-stock">' + (p.in_stock === true ? 'In Stock' : p.in_stock === false ? 'Out of Stock' : 'Confirm availability') + '</span>' +
            '</div>' +
            '<div class="price-row">' +
              '<span class="product-price">' + formatPrice(p.price) + '</span>' +
              (hasDiscount ? '<span class="original-price">' + formatPrice(p.compare_at_price) + '</span>' : '') +
            '</div>' +
            '<div class="product-actions">' +
              '<button class="btn btn-cart" data-id="' + escapeHtml(p.id) + '">' + cartIcon + '</button>' +
              '<button class="btn btn-buy" data-id="' + escapeHtml(p.id) + '">Buy Now</button>' +
            '</div>' +
          '</div>';

        card.querySelector('.product-img-wrap')?.addEventListener('click', () => openLink(productUrl(p.slug)));
        card.querySelector('.product-name')?.addEventListener('click', () => openLink(productUrl(p.slug)));
        card.querySelector('.btn-cart')?.addEventListener('click', (e) => { e.stopPropagation(); openLink(cartUrl(p.id)); });
        card.querySelector('.btn-buy')?.addEventListener('click', (e) => { e.stopPropagation(); openLink(cartUrl(p.id)); });
        return card;
      });

      contentEl.innerHTML = '<div class="product-grid"></div><div class="cta-section"><h3>See All Products</h3><p>Browse our complete collection</p><button class="cta-btn" id="shop-btn">Shop Now</button></div>';
      const gridEl = contentEl.querySelector('.product-grid');
      grid.forEach(c => gridEl.appendChild(c));
      document.getElementById('shop-btn')?.addEventListener('click', () => openLink('https://ogabassey.com'));
    };

    const renderOrder = (order) => {
      if (!order) {
        contentEl.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg></div><p>Order not found</p></div>';
        return;
      }
      const statusClass = order.status || 'pending';
      const dateStr = new Date(order.created_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });

      contentEl.innerHTML =
        '<div class="order-card">' +
          '<div class="order-header">' +
            '<div class="order-title">' +
              '<div class="order-icon">📦</div>' +
              '<div><div class="order-number">#' + escapeHtml(order.order_number) + '</div><div class="order-date">' + dateStr + '</div></div>' +
            '</div>' +
            '<span class="status-badge ' + statusClass + '">' + escapeHtml(order.status) + '</span>' +
          '</div>' +
          '<div class="order-total">' +
            '<span class="order-total-label">Order Total</span>' +
            '<span class="order-total-value">' + formatPrice(order.total) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cta-section"><h3>Need Help?</h3><p>Contact support for order inquiries</p><button class="cta-btn" id="support-btn">Get Support</button></div>';

      document.getElementById('support-btn')?.addEventListener('click', () => openLink('https://ogabassey.com/pages/faq'));
    };

    window.addEventListener('openai:set_globals', (e) => {
      const out = e.detail?.globals?.toolOutput;
      if (out?.products) renderProducts(out.products);
      else if (out?.order) renderOrder(out.order);
    }, { passive: true });
    if (window.openai?.toolOutput) {
      const out = window.openai.toolOutput;
      if (out.products) renderProducts(out.products);
      else if (out.order) renderOrder(out.order);
    }
  </script>
</body>
</html>`;

// =============================================================================
// PREMIUM WIDGET LOADER
// =============================================================================

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load premium widget from bundled assets if available
function loadPremiumWidget(): string {
  // Check for bundled widget (built from widgets/src)
  const bundledPath = path.join(__dirname, 'assets', 'ogabassey-store.html');
  if (fs.existsSync(bundledPath)) {
    console.log('[Widget] Loading premium widget from:', bundledPath);
    return fs.readFileSync(bundledPath, 'utf8');
  }

  // Docker deployment path
  const dockerPath = '/app/assets/ogabassey-store.html';
  if (fs.existsSync(dockerPath)) {
    console.log('[Widget] Loading premium widget from Docker:', dockerPath);
    return fs.readFileSync(dockerPath, 'utf8');
  }

  // Fall back to inline widget
  console.log('[Widget] Using inline fallback widget');
  return widgetHtml;
}

// Cache the loaded widget
const premiumWidgetHtml = loadPremiumWidget();

// =============================================================================
// MCP SERVER FACTORY
// =============================================================================

function createOgabasseyServer() {
  const server = new McpServer({
    name: 'ogabassey-store',
    version: '1.0.0',
  });

  // Widget resource
  server.registerResource(
    'store-widget',
    'ui://widget/store.html',
    { description: 'Ogabassey store widget' },
    async () => ({
      contents: [
        {
          uri: 'ui://widget/store.html',
          mimeType: 'text/html+skybridge',
          text: premiumWidgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: MCP_PUBLIC_ORIGIN,
              csp: {
                connectDomains: [],
                resourceDomains: [MCP_PUBLIC_ORIGIN],
              },
            },
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: [MCP_PUBLIC_ORIGIN],
              redirect_domains: ['https://ogabassey.com'],
            },
            'openai/widgetDomain': MCP_PUBLIC_ORIGIN,
            'openai/ui': {
              availableDisplayModes: ['inline', 'fullscreen'],
            },
          },
        },
      ],
    })
  );

  // Tool: Search products
  server.registerTool(
    'search_products',
    {
      title: 'Search Products',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description:
        'Search the Ogabassey public catalog by name, brand, category, condition, and price. When the buyer asks for phones or smartphones, set category to Smartphones so tablets are excluded. Returns listed prices, variant options, and reported availability; it does not confirm a live stock reservation.',
      inputSchema: {
        query: z
          .string()
          .max(100)
          .optional()
          .describe('Search query (product name, brand, or keywords)'),
        condition: z
          .enum(['new', 'used', 'open_box', 'refurbished'])
          .optional()
          .describe('Product condition'),
        category: z
          .string()
          .max(50)
          .optional()
          .describe('Catalog category. Use Smartphones for phone requests, Tablets for tablet requests, and Laptops for laptop requests.'),
        brand: z.string().max(50).optional().describe('Brand name'),
        min_price: z.number().min(0).optional(),
        max_price: z.number().min(0).optional(),
        sort: z
          .enum(['price_asc', 'price_desc', 'newest', 'relevance'])
          .optional()
          .default('relevance'),
        limit: z.number().min(1).max(20).optional().default(10),
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/store.html',
        'openai/toolInvocation/invoking': 'Searching catalog...',
        'openai/toolInvocation/invoked': 'Search complete',
      },
    },
    async (args) => {
      try {
        const merchantId = await getMerchantId();
        if (!merchantId) throw new Error('Merchant ID unavailable');

        const { products, sanitizedQuery, sawRankedRows } =
          await loadMcpSearchProducts({
            args,
            merchantId,
            sanitizeString,
            supabase,
          });

        if (sanitizedQuery && !sawRankedRows) {
          return {
            content: [
              {
                type: 'text',
                text: `No specific products found for "${sanitizedQuery}". Try broader terms.`,
              },
            ],
            structuredContent: { products: [], status: 'empty' },
          };
        }

        // Graceful fallback for empty results
        if (!products || products.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No specific products found for "${sanitizedQuery || 'your criteria'}". Try broader terms.`,
              },
            ],
            structuredContent: { products: [], status: 'empty' },
          };
        }

        const hydratedProducts = await hydrateSearchProductAvailability(products, supabase);
        const formatted = hydratedProducts.map(({ product: p, stockSummary, availableVariants: variants }) => {
          // A compare-at price indicates a listed discount, not a price trend.
          const isDiscounted = p.compare_at_price && p.compare_at_price > p.price;

          // Variant Summary (e.g., "Available in: Black, White")
          const variantOptions: Record<string, Set<string>> = {};
          variants.forEach((v) => {
            Object.entries(v.attributes || {}).forEach(([key, val]) => {
              if (!variantOptions[key]) variantOptions[key] = new Set();
              variantOptions[key].add(String(val));
            });
          });
          const availableOptions = Object.entries(variantOptions)
            .map(([key, vals]) => `${key}: ${Array.from(vals).join(', ')}`)
            .join(' | ');

          return {
            id: p.id,
            name: p.name,
            slug: p.slug,
            price: p.price,
            compare_at_price: p.compare_at_price,
            image: getSafeCatalogImageUrl(p.images?.[0]?.url || p.images?.[0]),
            condition: resolveMcpSearchProductCondition(p, args.condition),
            brand: p.brand,
            category: p.category,
            in_stock: stockSummary.inStock,

            // New Intelligence Fields
            stock_level: stockSummary.level,
            stock_confidence: stockSummary.confidence,
            price_status: isDiscounted ? 'discounted' : 'regular',
            available_variants: availableOptions || 'Standard',
            last_updated: p.updated_at,
          };
        });

        // 4. Construct Response
        const count = formatted.length;
        if (count === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No specific products found for "${sanitizedQuery || 'your criteria'}". Try broader terms.`,
              },
            ],
            structuredContent: { products: [], status: 'empty' },
          };
        }
        const resultText = [
          `Found ${count} Ogabassey products. Prices are listed in NGN; confirm availability before checkout.`,
          ...formatted.map((product) =>
            `${product.name} — ₦${Number(product.price).toLocaleString('en-NG')} (${product.stock_level}); ${product.available_variants}.`
          ),
        ].join('\n');

        return {
          content: [{ type: 'text', text: resultText }],
          structuredContent: {
            status: 'success',
            products: formatted,
            meta: { total: count, query: sanitizedQuery },
          },
          _meta: {
            'openai/outputTemplate': 'ui://widget/store.html',
            'openai/widgetPrefersBorder': true,
          },
        };
      } catch (err: any) {
        console.error('Search Critical Error:', err);
        // Graceful Degradation (Unbreakable)
        return {
          content: [
            {
              type: 'text',
              text: 'Search is experimenting mild turbulence but I can still help. Please try listing a specific category.',
            },
          ],
          structuredContent: {
            status: 'error',
            message: 'Search service temporarily degraded',
            products: [],
          },
        };
      }
    }
  );

  // Tool: Add to Cart (Widget-accessible)
  // This tool can be called from the widget iframe using window.openai.callTool
  server.registerTool(
    'add_to_cart',
    {
      title: 'Add to Cart',

      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description:
        'Help the shopper add a public product to their Ogabassey cart. Simple products return a cart URL that adds the item when opened; products with options link to their product page for selection. This tool does not save an item inside ChatGPT or start checkout.',
      inputSchema: {
        product_id: z.string().describe('The product ID to add to cart'),
        quantity: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(1)
          .describe('Quantity to add'),
      },
      _meta: {
        'openai/widgetAccessible': true, // Enable widget-initiated calls
        'openai/toolInvocation/invoking': 'Finding your cart on Ogabassey...',
        'openai/toolInvocation/invoked': 'Ready to add on Ogabassey',
      },
    },
    async (args) => {
      try {
        const merchantId = await getMerchantId();
        if (!merchantId) {
          return {
            content: [{ type: 'text', text: '❌ Unable to access store.' }],
          };
        }

        return prepareCartHandoff({
          supabase,
          merchantId,
          productId: args.product_id,
          quantity: args.quantity,
          formatPrice,
        });
      } catch (error) {
        console.error('Add to cart error:', error);
        return {
          content: [{ type: 'text', text: '❌ Unable to add item to cart.' }],
        };
      }
    }
  );

  const agenticCheckoutClientConfig = getAgenticCheckoutClientConfig();
  if (agenticCheckoutClientConfig) {
    registerAgenticUcpTools(server, agenticCheckoutClientConfig);

    server.registerTool(
      'create_agentic_checkout_session',
      {
        title: 'Create Agentic Checkout Session',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: false,
        },
        description:
          'Create a real Baci agentic checkout session through the signed and idempotent /api/agentic/checkout_sessions flow. Use this after the customer chooses products and quantities to get authoritative totals, fulfillment options, and the checkout session id. This does not complete payment or create an order. To safely retry requests on failure, generate a unique idempotency_key before the first request and reuse it for subsequent retries.',
        inputSchema: createAgenticCheckoutSessionMcpInputSchema,
        _meta: {
          'openai/toolInvocation/invoking': 'Creating checkout session...',
          'openai/toolInvocation/invoked': 'Checkout session created',
        },
      },
      async (args) => {
        const result = await createAgenticCheckoutSession(
          args,
          agenticCheckoutClientConfig
        );

        if (result.ok === false) {
          return buildAgenticCheckoutErrorResponse({
            action: 'create an agentic checkout session',
            result,
          });
        }

        const sessionId =
          getCheckoutSessionField(result.response, 'id') ?? 'the new session';
        const checkoutStatus =
          getCheckoutSessionField(result.response, 'status') ?? 'created';

        return {
          content: [
            {
              type: 'text',
              text:
                `✅ Created Baci agentic checkout session **${sessionId}**.\n\n` +
                `Status: **${checkoutStatus}**\n\n` +
                'Review the returned totals and fulfillment options before asking the buyer to confirm payment.',
            },
          ],
          structuredContent: {
            checkout_session: result.response,
            endpoint: result.endpoint,
            idempotency_key: result.idempotencyKey,
            request_id: result.requestId,
            status: 'success',
          },
        };
      }
    );

    server.registerTool(
      'get_agentic_checkout_session',
      {
        title: 'Get Agentic Checkout Session',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: true,
        },
        description:
          'Read the current state of a Baci agentic checkout session with a signed request. Use this after creating or updating a session to confirm totals, fulfillment options, payment state, and status.',
        inputSchema: getAgenticCheckoutSessionInputSchema,
        _meta: {
          'openai/toolInvocation/invoking': 'Reading checkout session...',
          'openai/toolInvocation/invoked': 'Checkout session loaded',
        },
      },
      async (args) => {
        const result = await getAgenticCheckoutSession(
          args,
          agenticCheckoutClientConfig
        );

        if (result.ok === false) {
          return buildAgenticCheckoutErrorResponse({
            action: 'read the agentic checkout session',
            result,
          });
        }

        const sessionId =
          getCheckoutSessionField(result.response, 'id') ?? args.session_id;
        const checkoutStatus =
          getCheckoutSessionField(result.response, 'status') ?? 'unknown';

        return {
          content: [
            {
              type: 'text',
              text:
                `Checkout session **${sessionId}** is **${checkoutStatus}**.\n\n` +
                'Use the returned totals and fulfillment options as the authoritative checkout state.',
            },
          ],
          structuredContent: {
            checkout_session: result.response,
            endpoint: result.endpoint,
            request_id: result.requestId,
            status: 'success',
          },
        };
      }
    );

    server.registerTool(
      'update_agentic_checkout_session',
      {
        title: 'Update Agentic Checkout Session',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: false,
        },
        description:
          'Update a Baci agentic checkout session through the signed and idempotent /api/agentic/checkout_sessions/{session_id} flow. Use this to change items, add or replace shipping details, or select a fulfillment option before payment confirmation. To safely retry, generate a unique idempotency_key before the first request and reuse it for retries.',
        inputSchema: updateAgenticCheckoutSessionMcpInputSchema,
        _meta: {
          'openai/toolInvocation/invoking': 'Updating checkout session...',
          'openai/toolInvocation/invoked': 'Checkout session updated',
        },
      },
      async (args) => {
        const result = await updateAgenticCheckoutSession(
          args,
          agenticCheckoutClientConfig
        );

        if (result.ok === false) {
          return buildAgenticCheckoutErrorResponse({
            action: 'update the agentic checkout session',
            result,
          });
        }

        const sessionId =
          getCheckoutSessionField(result.response, 'id') ?? args.session_id;
        const checkoutStatus =
          getCheckoutSessionField(result.response, 'status') ?? 'updated';

        return {
          content: [
            {
              type: 'text',
              text:
                `Updated checkout session **${sessionId}**.\n\n` +
                `Status: **${checkoutStatus}**\n\n` +
                'Review the returned totals and fulfillment options before asking the buyer to confirm payment.',
            },
          ],
          structuredContent: {
            checkout_session: result.response,
            endpoint: result.endpoint,
            idempotency_key: result.idempotencyKey,
            request_id: result.requestId,
            status: 'success',
          },
        };
      }
    );

    server.registerTool(
      'complete_agentic_checkout_session',
      {
        title: 'Complete Agentic Checkout Session',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
          idempotentHint: false,
        },
        description:
          'Complete a Baci agentic checkout session through the signed and idempotent /api/agentic/checkout_sessions/{session_id}/complete flow. Use this only after the buyer provides a verified human confirmation artifact or an accepted payment mandate for the exact session, amount, and currency. Baci fails closed when authorization is missing or invalid, and this may create payment or order side effects when authorization is valid. To safely retry, generate a unique idempotency_key before the first request and reuse it for retries.',
        inputSchema: completeAgenticCheckoutSessionInputSchema,
        _meta: {
          'openai/toolInvocation/invoking': 'Completing checkout session...',
          'openai/toolInvocation/invoked': 'Checkout session completion requested',
        },
      },
      async (args) => {
        const result = await completeAgenticCheckoutSession(
          args,
          agenticCheckoutClientConfig
        );

        if (result.ok === false) {
          return buildAgenticCheckoutErrorResponse({
            action: 'complete the agentic checkout session',
            result,
          });
        }

        const sessionId =
          getCheckoutSessionField(result.response, 'id') ?? args.session_id;
        const checkoutStatus =
          getCheckoutSessionField(result.response, 'status') ?? 'completed';
        const paymentState = getCheckoutSessionField(
          result.response,
          'payment_state'
        );

        return {
          content: [
            {
              type: 'text',
              text:
                `Checkout completion requested for **${sessionId}**.\n\n` +
                `Status: **${checkoutStatus}**` +
                (paymentState ? `\n\nPayment state: **${paymentState}**` : ''),
            },
          ],
          structuredContent: {
            checkout_session: result.response,
            endpoint: result.endpoint,
            idempotency_key: result.idempotencyKey,
            request_id: result.requestId,
            status: 'success',
          },
        };
      }
    );

    server.registerTool(
      'cancel_agentic_checkout_session',
      {
        title: 'Cancel Agentic Checkout Session',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
          idempotentHint: false,
        },
        description:
          'Cancel a mutable Baci agentic checkout session through the signed and idempotent /api/agentic/checkout_sessions/{session_id}/cancel flow. Use this only when the buyer abandons checkout or asks to discard the session. To safely retry, generate a unique idempotency_key before the first request and reuse it for retries.',
        inputSchema: cancelAgenticCheckoutSessionInputSchema,
        _meta: {
          'openai/toolInvocation/invoking': 'Canceling checkout session...',
          'openai/toolInvocation/invoked': 'Checkout session canceled',
        },
      },
      async (args) => {
        const result = await cancelAgenticCheckoutSession(
          args,
          agenticCheckoutClientConfig
        );

        if (result.ok === false) {
          return buildAgenticCheckoutErrorResponse({
            action: 'cancel the agentic checkout session',
            result,
          });
        }

        const sessionId =
          getCheckoutSessionField(result.response, 'id') ?? args.session_id;
        const checkoutStatus =
          getCheckoutSessionField(result.response, 'status') ?? 'canceled';

        return {
          content: [
            {
              type: 'text',
              text: `Canceled checkout session **${sessionId}**. Status: **${checkoutStatus}**.`,
            },
          ],
          structuredContent: {
            checkout_session: result.response,
            endpoint: result.endpoint,
            idempotency_key: result.idempotencyKey,
            request_id: result.requestId,
            status: 'success',
          },
        };
      }
    );
  } else {
    console.warn(
      'Agentic checkout tools disabled: missing BACI_AGENTIC_ACCESS_TOKEN or BACI_AGENTIC_SIGNING_KEY'
    );
  }

  // Tool: Get product details
  server.registerTool(
    'get_product',
    {
      title: 'Get Product Details',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description:
        'Get detailed information about a specific product including variants, conditions, specifications, and reviews. Use product_id when available; otherwise use the exact product_name returned by search_products.',
      inputSchema: productLookupInputSchema,
      _meta: {
        'openai/outputTemplate': 'ui://widget/store.html',
        'openai/toolInvocation/invoking': 'Loading product...',
        'openai/toolInvocation/invoked': 'Product loaded',
      },
    },
    async (args) => {
      const merchantId = await getMerchantId();
      if (!merchantId) {
        return {
          content: [{ type: 'text', text: 'Store temporarily unavailable.' }],
          structuredContent: { products: [] },
        };
      }

      const sanitizedProductId = args.product_id
        ? sanitizeString(args.product_id, 80)
        : '';
      const sanitizedName = args.product_name
        ? sanitizeString(args.product_name, 100)
        : '';
      const lookupLabel = sanitizedProductId || sanitizedName;

      if (!lookupLabel) {
        return {
          content: [
            {
              type: 'text',
              text: 'Please provide a valid product ID or product name.',
            },
          ],
          structuredContent: { products: [] },
        };
      }

      // Fetch product with all details
      let productQuery = supabase
        .from('products')
        .select(`
          id, name, slug, price, compare_at_price, images, description, stock_quantity, manage_stock,
          condition, condition_detail, brand, category, has_variants, has_condition_offers,
          weight_value, weight_unit, dimensions, schema_markup
        `)
        .eq('merchant_id', merchantId)
        .eq('status', 'active');

      productQuery = sanitizedProductId
        ? productQuery.eq('id', sanitizedProductId)
        : productQuery.ilike('name', `%${sanitizedName}%`);

      const { data: product, error: productError } = await productQuery
        .limit(1)
        .single();

      if (productError || !product) {
        if (productError && productError.code !== 'PGRST116') {
          console.error(
            JSON.stringify({
              type: 'error',
              context: 'get_product',
              message: productError.message,
            })
          );
        }
        return {
          content: [
            { type: 'text', text: `Product "${lookupLabel}" not found.` },
          ],
          structuredContent: { products: [] },
        };
      }

      // Fetch variants if product has variants
      let variants: Array<{
        attributes: Record<string, string>;
        price_override: number | null;
        stock_quantity: number;
        condition: string;
        images: unknown[];
      }> = [];
      if (product.has_variants) {
        const { data: variantData, error: variantError } = await supabase.rpc(
          'get_storefront_product_variants',
          { p_product_ids: [product.id] }
        );
        if (variantError) {
          console.error('Failed to fetch public product variants:', variantError);
          return { content: [{ type: 'text', text: 'Product variants are temporarily unavailable.' }] };
        }
        variants = variantData || [];
      }

      // Fetch condition offers if available
      let conditionOffers: Array<{
        condition: string;
        price: number;
        stock_quantity: number;
        grade: string | null;
        condition_notes: string | null;
      }> = [];
      if (product.has_condition_offers) {
        const { data: offerData, error: offerError } = await supabase.rpc('get_product_offers', {
          p_product_id: product.id,
        });
        if (offerError) {
          console.error('Failed to fetch public product offers:', offerError);
          return { content: [{ type: 'text', text: 'Product offers are temporarily unavailable.' }] };
        }
        conditionOffers = offerData || [];
      }

      // Get rating from schema_markup if available
      const rating = product.schema_markup?.aggregateRating?.ratingValue;
      const reviewCount = product.schema_markup?.aggregateRating?.reviewCount;

      const stockSummary = getMcpProductStockSummary(
        product,
        product.has_variants ? variants : undefined,
        product.has_condition_offers ? conditionOffers : undefined
      );
      const formatted = {
        id: product.id,
        name: product.name,
        slug: product.slug,
        price: product.price,
        compare_at_price: product.compare_at_price,
        image: getSafeCatalogImageUrl(product.images?.[0]?.url || product.images?.[0]) ?? null,
        condition: product.condition || 'new',
        condition_detail: product.condition_detail,
        brand: product.brand,
        category: product.category,
        in_stock: stockSummary.inStock,
        stock_confidence: stockSummary.confidence,
        stock_level: stockSummary.level,
        has_variants: product.has_variants,
      };

      // Build detailed text response
      let text = `**${product.name}**\n\n`;
      text += `**Price:** ${formatPrice(product.price)}`;
      if (
        product.compare_at_price &&
        product.compare_at_price > product.price
      ) {
        const discount = Math.round(
          (1 - product.price / product.compare_at_price) * 100
        );
        text += ` ~~${formatPrice(product.compare_at_price)}~~ (${discount}% off)`;
      }
      text += '\n';

      // Condition info
      if (product.condition && product.condition !== 'new') {
        text += `**Condition:** ${product.condition}${product.condition_detail ? ` - ${product.condition_detail}` : ''}\n`;
      }

      // Brand & Category
      if (product.brand) text += `**Brand:** ${product.brand}\n`;
      if (product.category) text += `**Category:** ${product.category}\n`;

      // Rating
      if (rating) {
        text += `**Rating:** ${rating}/5${reviewCount ? ` (${reviewCount} reviews)` : ''}\n`;
      }

      // Description
      if (product.description) {
        text += `\n${product.description}\n`;
      }

      // Variants summary
      if (variants.length > 0) {
        const colors = [
          ...new Set(variants.map((v) => v.attributes?.color).filter(Boolean)),
        ];
        const storageOptions = [
          ...new Set(
            variants.map((v) => v.attributes?.storage).filter(Boolean)
          ),
        ];
        if (colors.length > 0)
          text += `\n**Available Colors:** ${colors.join(', ')}`;
        if (storageOptions.length > 0)
          text += `\n**Storage Options:** ${storageOptions.join(', ')}`;
      }

      // Condition offers summary
      if (conditionOffers.length > 0) {
        text += '\n\n**Available Conditions:**\n';
        for (const offer of conditionOffers) {
          text += `• ${offer.condition}${offer.grade ? ` (Grade ${offer.grade})` : ''}: ${formatPrice(offer.price)}`;
          text += ` - ${getMcpOfferAvailability(product.manage_stock, offer.stock_quantity).label}`;
          text += '\n';
        }
      }

      // Stock & Link
      text += `\n**Availability:** ${formatted.in_stock === true ? 'In Stock' : formatted.in_stock === false ? 'Out of Stock' : 'Confirm at checkout'}`;
      const productPageUrl = product.slug
        ? `https://ogabassey.com/products/${encodeURIComponent(product.slug)}`
        : 'https://ogabassey.com/products';
      text += `\n\n🔗 [View Product](${productPageUrl})`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          products: [formatted],
          variants: variants.map((v) => ({
            attributes: v.attributes,
            price: v.price_override,
            stock: product.manage_stock ? v.stock_quantity : null,
            availability: getMcpOfferAvailability(product.manage_stock, v.stock_quantity).availability,
            condition: v.condition,
          })),
          condition_offers: conditionOffers.map((offer) => ({
            ...offer,
            stock_quantity: product.manage_stock ? offer.stock_quantity : null,
            availability: getMcpOfferAvailability(product.manage_stock, offer.stock_quantity).availability,
          })),
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/store.html',
          'openai/widgetPrefersBorder': true,
        },
      };
    }
  );

  if (ORDER_PAYMENT_TOOLS_ENABLED) {
    // Tool: Check order status
    server.registerTool(
      'check_order',
      {
        title: 'Check Order Status',
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        description: 'Look up order status by order number or phone.',
        inputSchema: {
          order_number: z
            .string()
            .max(20)
            .optional()
            .describe('Order number (e.g., ORD-12345)'),
          phone: z.string().max(20).optional().describe('Phone number'),
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/store.html',
          'openai/toolInvocation/invoking': 'Looking up order...',
          'openai/toolInvocation/invoked': 'Order found',
        },
      },
      async (args) => {
        if (!args.order_number && !args.phone) {
          return {
            content: [
              { type: 'text', text: 'Please provide order number or phone.' },
            ],
            structuredContent: { order: null },
          };
        }

        // Validate inputs
        if (args.order_number && !isValidOrderNumber(args.order_number)) {
          return {
            content: [{ type: 'text', text: 'Invalid order number format.' }],
            structuredContent: { order: null },
          };
        }
        if (args.phone && !isValidPhone(args.phone)) {
          return {
            content: [{ type: 'text', text: 'Invalid phone number format.' }],
            structuredContent: { order: null },
          };
        }

        const merchantId = await getMerchantId();
        if (!merchantId) {
          return {
            content: [{ type: 'text', text: 'Store temporarily unavailable.' }],
            structuredContent: { order: null },
          };
        }

        let query = supabase
          .from('orders')
          .select('id, order_number, status, total, created_at')
          .eq('merchant_id', merchantId);

        if (args.order_number) {
          query = query.eq(
            'order_number',
            sanitizeString(args.order_number, 20).toUpperCase()
          );
        } else if (args.phone) {
          query = query.ilike(
            'shipping_address->>phone',
            `%${sanitizeString(args.phone, 20)}%`
          );
        }

        const { data: order, error: orderError } = await query
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (orderError || !order) {
          if (orderError && orderError.code !== 'PGRST116') {
            console.error(
              JSON.stringify({
                type: 'error',
                context: 'check_order',
                message: orderError.message,
              })
            );
          }
          return {
            content: [{ type: 'text', text: 'Order not found.' }],
            structuredContent: { order: null },
          };
        }

        const statusMessages: Record<string, string> = {
          pending: 'Your order is pending confirmation.',
          processing: 'Your order is being processed.',
          shipped: 'Your order has been shipped!',
          delivered: 'Your order has been delivered.',
          cancelled: 'This order was cancelled.',
        };

        // Redact sensitive order data - only return necessary fields
        const safeOrder = {
          order_number: order.order_number,
          status: order.status,
          total: order.total,
          created_at: order.created_at,
        };

        return {
          content: [
            {
              type: 'text',
              text: `**Order #${order.order_number}**\n\nStatus: ${order.status}\n${statusMessages[order.status] || ''}\n\nTotal: ${formatPrice(order.total)}\nDate: ${new Date(order.created_at).toLocaleDateString()}`,
            },
          ],
          structuredContent: { order: safeOrder },
        };
      }
    );
  }

  // Tool: Get store info (read-only, no sensitive data)
  server.registerTool(
    'get_store_info',
    {
      title: 'Get Store Information',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description: 'Get Ogabassey public store information and current policy page links. Confirm delivery and payment details at checkout.',
      inputSchema: {
        topic: z
          .enum(['contact', 'shipping', 'returns', 'payment', 'general'])
          .optional()
          .describe('Topic'),
      },
      _meta: {
        'openai/toolInvocation/invoking': 'Loading info...',
        'openai/toolInvocation/invoked': 'Info loaded',
      },
    },
    async (args) => {
      const info: Record<string, string> = {
        general:
          '**Ogabassey** sells physical consumer electronics. Browse products and check current details at https://ogabassey.com.',
        contact:
          '**Contact**\n\nUse the current Ogabassey help page: https://ogabassey.com/contact.',
        shipping:
          '**Shipping**\n\nReview the current policy at https://ogabassey.com/shipping. Delivery availability, fees, and timing depend on the order and must be confirmed at checkout.',
        returns:
          '**Returns**\n\nReview eligibility and the current process at https://ogabassey.com/returns. Contact support before sending an item back.',
        payment:
          '**Payment**\n\nAvailable payment methods are shown during checkout on https://ogabassey.com.',
      };
      return {
        content: [{ type: 'text', text: info[args.topic || 'general'] }],
      };
    }
  );

  // Tool: Get recommendations
  server.registerTool(
    'get_recommendations',
    {
      title: 'Get Recommendations',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description: 'Get product recommendations based on use case and budget.',
      inputSchema: {
        use_case: z
          .string()
          .min(1)
          .max(50)
          .describe('What the product is for (gaming, work, etc.)'),
        budget: z
          .number()
          .min(0)
          .max(1000000000)
          .optional()
          .describe('Max budget in NGN'),
      },
      _meta: {
        'openai/outputTemplate': 'ui://widget/store.html',
        'openai/toolInvocation/invoking': 'Finding recommendations...',
        'openai/toolInvocation/invoked': 'Recommendations ready',
      },
    },
    async (args) => {
      const merchantId = await getMerchantId();
      if (!merchantId) {
        return {
          content: [{ type: 'text', text: 'Store temporarily unavailable.' }],
          structuredContent: { products: [] },
        };
      }

      const sanitizedUseCase = sanitizeString(args.use_case, 50).toLowerCase();
      const keywords: Record<string, string[]> = {
        gaming: ['gaming', 'pro', 'max'],
        work: ['pro', 'business', 'macbook'],
        photography: ['camera', 'pro', 'ultra'],
        budget: ['lite', 'mini'],
        student: ['ipad', 'laptop', 'air'],
      };

      const kws = keywords[sanitizedUseCase] || [sanitizedUseCase];

      let query = supabase
        .from('products')
        .select(
          'id, name, slug, price, compare_at_price, images, description, condition, brand, category, manage_stock, stock_quantity, has_variants, has_condition_offers'
        )
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .or('manage_stock.is.false,manage_stock.is.null,stock_quantity.gt.0,has_variants.is.true,has_condition_offers.is.true')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

      if (args.budget) {
        query = query.lte('price', sanitizePrice(args.budget) ?? 1000000000);
      }

      const final = await selectRecommendedProducts({
        keywords: kws,
        fetchPage: async (offset, limit) => {
          const { data, error } = await query.range(offset, offset + limit - 1);
          return error ? null : data;
        },
        fetchVariants: async (ids) => {
          const { data, error } = await supabase.rpc('get_storefront_product_variants', { p_product_ids: ids });
          return error ? null : data;
        },
        fetchOffers: async (ids) => {
          const { data, error } = await supabase.from('product_offers')
            .select('product_id, stock_quantity')
            .eq('merchant_id', merchantId)
            .eq('status', 'active')
            .in('product_id', ids);
          return error ? null : data;
        },
      });

      const formatted = final.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: p.price,
        image: getSafeCatalogImageUrl(p.images?.[0]?.url || p.images?.[0]),
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Based on "${sanitizedUseCase}"${args.budget ? ` (budget: ${formatPrice(args.budget)})` : ''}, here are my recommendations:`,
          },
        ],
        structuredContent: { products: formatted },
        _meta: {
          'openai/outputTemplate': 'ui://widget/store.html',
          'openai/widgetPrefersBorder': true,
        },
      };
    }
  );
  // [REMOVED] smart_recommend
  // [REMOVED] estimate_trade_in
  // [REMOVED] find_gift
  // [REMOVED] calculate_installment
  // [REMOVED] find_deals


  // Tool: Get product variants
  server.registerTool(
    'get_product_variants',
    {
      title: 'Get Product Variants',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description:
        'Get listed variants (colors, storage options, conditions) for a product. Availability is confirmed only when stock is tracked. Use product_id when available; otherwise use the exact product_name returned by search_products.',
      inputSchema: productLookupInputSchema,
      _meta: {
        'openai/toolInvocation/invoking': 'Loading variants...',
        'openai/toolInvocation/invoked': 'Variants loaded',
      },
    },
    async (args) => {
      const merchantId = await getMerchantId();
      if (!merchantId) {
        return {
          content: [{ type: 'text', text: 'Store temporarily unavailable.' }],
        };
      }

      const sanitizedProductId = args.product_id
        ? sanitizeString(args.product_id, 80)
        : '';
      const sanitizedName = args.product_name
        ? sanitizeString(args.product_name, 100)
        : '';
      const lookupLabel = sanitizedProductId || sanitizedName;

      if (!lookupLabel) {
        return {
          content: [
            {
              type: 'text',
              text: 'Please provide a valid product ID or product name.',
            },
          ],
        };
      }

      // First find the product
      let productQuery = supabase
        .from('products')
        .select('id, name, has_variants, has_condition_offers, manage_stock')
        .eq('merchant_id', merchantId)
        .eq('status', 'active');

      productQuery = sanitizedProductId
        ? productQuery.eq('id', sanitizedProductId)
        : productQuery.ilike('name', `%${sanitizedName}%`);

      const { data: product, error: productError } = await productQuery
        .limit(1)
        .single();

      if (productError || !product) {
        if (productError && productError.code !== 'PGRST116') {
          console.error(
            JSON.stringify({
              type: 'error',
              context: 'get_product_variants',
              message: productError.message,
            })
          );
        }
        return {
          content: [
            { type: 'text', text: `Product "${lookupLabel}" not found.` },
          ],
        };
      }

      // Fetch variants
      const { data: variants, error: variantsError } = await supabase.rpc(
        'get_storefront_product_variants',
        { p_product_ids: [product.id] }
      );
      if (variantsError) {
        console.error('Failed to fetch public product variants:', variantsError);
        return { content: [{ type: 'text', text: 'Product variants are temporarily unavailable.' }] };
      }

      // Fetch condition offers
      const { data: offers, error: offersError } = await supabase.rpc('get_product_offers', {
        p_product_id: product.id,
      });
      if (offersError) {
        console.error('Failed to fetch public product offers:', offersError);
        return { content: [{ type: 'text', text: 'Product offers are temporarily unavailable.' }] };
      }

      if (
        (!variants || variants.length === 0) &&
        (!offers || offers.length === 0)
      ) {
        return {
          content: [
            {
              type: 'text',
              text: `No variants available for "${product.name}".`,
            },
          ],
        };
      }

      let text = `**Variants for ${product.name}:**\n\n`;

      if (variants && variants.length > 0) {
        // Group by attribute type
        const colors = [
          ...new Set(variants.map((v) => v.attributes?.color).filter(Boolean)),
        ];
        const storages = [
          ...new Set(
            variants.map((v) => v.attributes?.storage).filter(Boolean)
          ),
        ];
        const sizes = [
          ...new Set(variants.map((v) => v.attributes?.size).filter(Boolean)),
        ];

        if (colors.length > 0) text += `**Colors:** ${colors.join(', ')}\n`;
        if (storages.length > 0)
          text += `**Storage:** ${storages.join(', ')}\n`;
        if (sizes.length > 0) text += `**Sizes:** ${sizes.join(', ')}\n`;

        text += '\n**Available Combinations:**\n';
        for (const v of variants.slice(0, 10)) {
          const attrs = Object.entries(v.attributes || {})
            .map(([k, val]) => `${k}: ${val}`)
            .join(', ');
          const price = v.price_override
            ? formatPrice(v.price_override)
            : 'Base price';
          const stock = !product.manage_stock
            ? 'Confirm availability with Ogabassey'
            : v.stock_quantity > 0
              ? 'In Stock'
              : 'Out of Stock';
          text += `• ${attrs} - ${price} (${stock})\n`;
        }
      }

      if (offers && offers.length > 0) {
        text += '\n**Condition Options:**\n';
        for (const o of offers) {
          const grade = o.grade ? ` (Grade ${o.grade})` : '';
          const stock = getMcpOfferAvailability(product.manage_stock, o.stock_quantity).label;
          text += `• ${o.condition}${grade}: ${formatPrice(o.price)} - ${stock}\n`;
          if (o.condition_notes) text += `  Note: ${o.condition_notes}\n`;
        }
      }

      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          product_name: product.name,
          variants: (variants || []).map((variant) => ({
            ...variant,
            stock_quantity: product.manage_stock ? variant.stock_quantity : null,
            availability: !product.manage_stock
              ? 'unconfirmed'
              : variant.stock_quantity > 0
                ? 'in_stock'
                : 'out_of_stock',
          })),
          condition_offers: (offers || []).map((offer) => ({
            ...offer,
            stock_quantity: product.manage_stock ? offer.stock_quantity : null,
            availability: getMcpOfferAvailability(product.manage_stock, offer.stock_quantity).availability,
          })),
        },
      };
    }
  );

  // Tool: Browse categories
  server.registerTool(
    'browse_categories',
    {
      title: 'Browse Categories',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description: 'Get a list of product categories available in the store.',
      inputSchema: {},
      _meta: {
        'openai/toolInvocation/invoking': 'Loading categories...',
        'openai/toolInvocation/invoked': 'Categories loaded',
      },
    },
    async () => {
      const merchantId = await getMerchantId();
      if (!merchantId) {
        return {
          content: [{ type: 'text', text: 'Store temporarily unavailable.' }],
        };
      }

      // Get unique categories from products
      const { data: products } = await supabase
        .from('products')
        .select('category')
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .or('manage_stock.is.false,manage_stock.is.null,stock_quantity.gt.0');

      const categories = [
        ...new Set((products || []).map((p) => p.category).filter(Boolean)),
      ];

      if (categories.length === 0) {
        return { content: [{ type: 'text', text: 'No categories found.' }] };
      }

      const text = `**Available Categories:**\n\n${categories.map((c) => `• ${c}`).join('\n')}\n\nAsk me to search for products in any of these categories!`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: { categories },
      };
    }
  );

  // Tool: Get brands
  server.registerTool(
    'get_brands',
    {
      title: 'Get Available Brands',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description: 'Get a list of brands available in the store.',
      inputSchema: {
        category: z
          .string()
          .max(50)
          .optional()
          .describe('Filter brands by category'),
      },
      _meta: {
        'openai/toolInvocation/invoking': 'Loading brands...',
        'openai/toolInvocation/invoked': 'Brands loaded',
      },
    },
    async (args) => {
      const merchantId = await getMerchantId();
      if (!merchantId) {
        return {
          content: [{ type: 'text', text: 'Store temporarily unavailable.' }],
        };
      }

      let query = supabase
        .from('products')
        .select('brand')
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .or('manage_stock.is.false,manage_stock.is.null,stock_quantity.gt.0');

      if (args.category) {
        const sanitizedCategory = sanitizeString(args.category, 50);
        query = query.ilike('category', `%${sanitizedCategory}%`);
      }

      const { data: products } = await query;

      const brands = [
        ...new Set((products || []).map((p) => p.brand).filter(Boolean)),
      ];

      if (brands.length === 0) {
        return { content: [{ type: 'text', text: 'No brands found.' }] };
      }

      const categoryText = args.category ? ` in ${args.category}` : '';
      const text = `**Available Brands${categoryText}:**\n\n${brands.map((b) => `• ${b}`).join('\n')}\n\nAsk me to search for products from any of these brands!`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: { brands },
      };
    }
  );

  // Tool: Compare products
  // [REMOVED] compare_products
  // [REMOVED] search_blog
  // [REMOVED] get_faq
  // [REMOVED] quick_help
  // [REMOVED] book_repair


  // The public shipping policy does not publish a fixed fee schedule.
  server.registerTool(
    'get_shipping_quote',
    {
      title: 'Check Delivery Fee Information',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description:
        'Explain how to obtain the final Ogabassey delivery fee for a Nigerian destination. The public policy does not specify fixed rates, so this tool cannot provide a numeric quote; the buyer must confirm the fee and timing at checkout.',
      inputSchema: {
        state: z.string().min(2).max(50).describe('Nigerian delivery state'),
        city: z.string().min(2).max(100).optional().describe('Delivery city'),
      },
      _meta: {
        'openai/toolInvocation/invoking': 'Checking delivery information...',
        'openai/toolInvocation/invoked': 'Delivery information ready',
      },
    },
    async (args) => {
      const state = sanitizeString(args.state, 50);
      const city = args.city ? sanitizeString(args.city, 100) : null;
      const destination = city ? `${city}, ${state}` : state;
      const policyUrl = 'https://ogabassey.com/shipping';
      return {
        content: [{
          type: 'text',
          text: `Ogabassey does not publish a fixed delivery fee for ${destination}. Enter the delivery address at checkout to confirm the fee, eligibility for any free delivery, and timing. Read the current shipping policy: ${policyUrl}`,
        }],
        structuredContent: {
          city,
          fee: null,
          policy_url: policyUrl,
          quote_available: false,
          state,
          status: 'requires_checkout',
        },
      };
    }
  );

  // [REMOVED] ask_santa


  if (ORDER_PAYMENT_TOOLS_ENABLED) {
    const paystackDvaAccess = resolveMcpPaystackDvaAccess();
    // Tool: Generate Payment Account (DVA for bank transfers)
    if (paystackDvaAccess.toolEnabled) {
      server.registerTool(
      'generate_payment_account',
      {
        title: 'Generate Payment Account',
        description:
          'Use this when a customer wants to pay via bank transfer. Generates a dedicated bank account (DVA) for them to transfer money to. REQUIRED: customer email, name, phone, and amount. Do NOT use if customer just wants to browse or hasn\'t decided to buy yet.',
        inputSchema: {
          // Zod 4 promotes string formats to top-level validators;
          // z.string().email() is deprecated in current Zod docs.
          customer_email: z.email()
            .describe('Customer email address (REQUIRED)'),
          customer_name: z
            .string()
            .min(2)
            .max(100)
            .describe('Customer full name (REQUIRED)'),
          customer_phone: z
            .string()
            .min(10)
            .max(20)
            .describe('Customer phone number (REQUIRED)'),
          amount: z
            .number()
            .min(100)
            .describe('Payment amount in Naira (REQUIRED)'),
          order_id: z
            .string()
            .optional()
            .describe('Order ID to link payment to (optional)'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false, // Does not delete data
          openWorldHint: true,    // Calls external Paystack API
          idempotentHint: false,  // Creates new order each time
        },
        _meta: {
          'openai/toolInvocation/invoking': 'Generating your bank account for payment...',
          'openai/toolInvocation/invoked': 'Payment account ready!',
        },
      },
      async (args) => {
        try {
          const { customer_email, customer_name, customer_phone, amount, order_id } = args;

          // Import the paystack function dynamically to avoid circular deps
          const { generatePaymentAccount } = await import('../src/lib/paystack');

          // Split name into first/last
          const nameParts = customer_name?.split(' ') || [];
          const firstName = nameParts[0] || undefined;
          const lastName = nameParts.slice(1).join(' ') || undefined;

          // Get merchant ID for chat order
          const merchantId = await getMerchantId();
          if (!merchantId) {
            return {
              content: [{ type: 'text', text: '❌ Store configuration error. Please try again later.' }],
            };
          }

          // Generate unique payment reference for this transaction
          const paymentReference = `CHAT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

          // Create chat order in database for tracking
          // Note: 'total' is a generated column (subtotal + shipping_fee), so we don't insert it
          const { data: chatOrder, error: orderError } = await supabase
            .from('chat_orders')
            .insert({
              merchant_id: merchantId,
              customer_email,
              customer_name,
              customer_phone,
              subtotal: amount,
              shipping_fee: 0,
              status: 'pending_payment',
              payment_method: 'bank_transfer',
              payment_reference: paymentReference,
              metadata: {
                source: 'chatbot',
                created_via: 'mcp_tool',
              },
            })
            .select('id, metadata')
            .single();

          if (orderError) {
            console.error('Failed to create chat order:', orderError);
            // Continue anyway - payment account can still be generated
          }

          const result = await generatePaymentAccount({
            email: customer_email,
            firstName,
            lastName,
            phone: customer_phone,
            orderId: chatOrder?.id || order_id,
          });

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Sorry, I couldn't generate a payment account right now. ${result.error}. Please try using card payment instead.`,
                },
              ],
            };
          }

          const { bank_name, account_number, account_name } = result.data;

          // Update chat order with payment account details
          if (chatOrder) {
            const { error: paymentMetadataError } = await supabase
              .from('chat_orders')
              .update({
                metadata: {
                  ...chatOrder.metadata,
                  bank_name,
                  account_number,
                  account_name,
                  customer_code: result.data.customer_code,
                },
              })
              .eq('id', chatOrder.id);

            if (paymentMetadataError) {
              console.error('Failed to update chat order payment metadata:', paymentMetadataError);
            }
          }

          // Format beautiful response
          let text = `💳 **Bank Transfer Payment Details**\n\n`;
          text += `To complete your payment of **₦${amount.toLocaleString()}**, transfer to:\n\n`;
          text += `┌────────────────────────────────┐\n`;
          text += `│  **Bank:** ${bank_name}\n`;
          text += `│  **Account Number:** ${account_number}\n`;
          text += `│  **Account Name:** ${account_name}\n`;
          text += `└────────────────────────────────┘\n\n`;
          if (chatOrder) {
            text += `🧾 **Order Reference:** ${paymentReference}\n\n`;
          }
          text += `📱 **How to pay:**\n`;
          text += `1. Open your bank app\n`;
          text += `2. Transfer exactly ₦${amount.toLocaleString()}\n`;
          text += `3. Come back and say "I've paid" or ask me to check your payment status!\n\n`;
          text += `⏰ This account is yours permanently - you can use it for future payments too.\n\n`;
          text += `_Your payment will be confirmed automatically once received._`;

          return {
            content: [{ type: 'text', text }],
            structuredContent: {
              payment_method: 'bank_transfer',
              bank_name,
              account_number,
              account_name,
              amount,
              currency: 'NGN',
              order_id: chatOrder?.id || order_id || null,
              payment_reference: paymentReference,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [
              {
                type: 'text',
                text: `❌ Error generating payment account: ${message}. Please try card payment instead.`,
              },
            ],
          };
        }
      }
      );
    }

    // Tool: Check Payment Status
    server.registerTool(
      'check_payment_status',
      {
        title: 'Check Payment Status',
        description:
          'Use this when a customer says they have paid, transferred money, or asks about their payment status. Trigger phrases: "I\'ve paid", "I sent it", "I transferred", "check my payment", "did you receive it", "payment done". REQUIRED: customer email. Do NOT use for generating new payment accounts.',
        inputSchema: {
          // Zod 4 promotes string formats to top-level validators;
          // z.string().email() is deprecated in current Zod docs.
          customer_email: z.email()
            .describe('Customer email address (REQUIRED)'),
          payment_reference: z
            .string()
            .optional()
            .describe('Payment reference (CHAT-xxx format) if known'),
        },
        annotations: {
          readOnlyHint: true,     // Only reads payment status
          destructiveHint: false,
          openWorldHint: true,    // Checks external payment status
          idempotentHint: true,   // Same result on repeated calls
        },
        _meta: {
          'openai/toolInvocation/invoking': 'Checking your payment status...',
          'openai/toolInvocation/invoked': 'Payment status retrieved!',
        },
      },
      async (args) => {
        try {
          const { customer_email, payment_reference } = args;

          const merchantId = await getMerchantId();
          if (!merchantId) {
            return {
              content: [{ type: 'text', text: '❌ Store configuration error.' }],
            };
          }

          // Find recent chat orders for this customer
          let query = supabase
            .from('chat_orders')
            .select('id, total, status, payment_reference, paid_at, metadata')
            .eq('merchant_id', merchantId)
            .eq('customer_email', customer_email)
            .order('created_at', { ascending: false })
            .limit(5);

          if (payment_reference) {
            query = query.eq('payment_reference', payment_reference);
          }

          const { data: orders, error } = await query;

          if (error || !orders || orders.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `🔍 I couldn't find any recent orders for ${customer_email}. Did you complete the checkout process first?`,
                },
              ],
            };
          }

          // Check the most recent order
          const order = orders[0];

          if (order.status === 'paid') {
            let text = `✅ **Payment Confirmed!**\n\n`;
            text += `Your payment of **₦${Number(order.total).toLocaleString()}** has been received.\n\n`;
            text += `🧾 **Order Reference:** ${order.payment_reference}\n`;
            text += `📅 **Paid at:** ${new Date(order.paid_at).toLocaleString()}\n\n`;
            text += `Thank you for your purchase! Your order is now being processed. 🎉`;

            return {
              content: [{ type: 'text', text }],
              structuredContent: {
                status: 'paid',
                order_id: order.id,
                amount: order.total,
                payment_reference: order.payment_reference,
                paid_at: order.paid_at,
              },
            };
          } else if (order.status === 'pending_payment') {
            const metadata = order.metadata || {};
            const storedDva =
              paystackDvaAccess.getDisclosableStoredDva(metadata);
            let text = `⏳ **Payment Pending**\n\n`;
            text += `We haven't received your payment of **₦${Number(order.total).toLocaleString()}** yet.\n\n`;

            if (storedDva) {
              text += `Please transfer to:\n`;
              text += `• **Bank:** ${storedDva.bankName}\n`;
              text += `• **Account:** ${storedDva.accountNumber}\n`;
              text += `• **Name:** ${storedDva.accountName}\n\n`;
            }

            text += `💡 Bank transfers can take a few minutes to process. If you've already transferred, please wait 2-3 minutes and check again.\n\n`;
            text += `🧾 **Order Reference:** ${order.payment_reference}`;

            return {
              content: [{ type: 'text', text }],
              structuredContent: {
                status: 'pending',
                order_id: order.id,
                amount: order.total,
                payment_reference: order.payment_reference,
                ...(storedDva
                  ? {
                      account_number: storedDva.accountNumber,
                      bank_name: storedDva.bankName,
                    }
                  : {}),
              },
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `ℹ️ Order status: **${order.status}**\n\nReference: ${order.payment_reference}`,
                },
              ],
              structuredContent: {
                status: order.status,
                order_id: order.id,
                payment_reference: order.payment_reference,
              },
            };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [
              {
                type: 'text',
                text: `❌ Error checking payment status: ${message}`,
              },
            ],
          };
        }
      }
    );
  }

  return server;
}

// =============================================================================
// HTTP SERVER
// =============================================================================

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const startTime = Date.now();
    const requestId = randomUUID();
    const ip = getClientIP(req);

    // Set security headers on all responses
    setSecurityHeaders(res);

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      logAudit({
        timestamp: new Date().toISOString(),
        requestId,
        ip,
        method: req.method || 'UNKNOWN',
        path: req.url || '/',
        statusCode: 408,
        durationMs: Date.now() - startTime,
        error: 'Request timeout',
      });
      if (!res.headersSent) {
        res.writeHead(408).end('Request Timeout');
      }
    });

    if (!req.url) {
      res.writeHead(400).end('Bad Request');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    // Image loads have a separate bounded budget from MCP tool calls.
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const imageLimit = checkProductImageRateLimit(ip);
      if (!imageLimit.allowed) {
        res.writeHead(429, { 'Retry-After': imageLimit.retryAfterSeconds }).end('Too Many Requests');
        return;
      }
      await serveProductImage(url.pathname, res, undefined, url.search);
      return;
    }

    // Rate limiting
    const rateLimit = checkRateLimit(ip);
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(rateLimit.resetAt / 1000));

    if (!rateLimit.allowed) {
      logAudit({
        timestamp: new Date().toISOString(),
        requestId,
        ip,
        method: req.method || 'UNKNOWN',
        path: url.pathname,
        statusCode: 429,
        durationMs: Date.now() - startTime,
        error: 'Rate limited',
      });
      res
        .writeHead(429, {
          'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        })
        .end('Too Many Requests');
      return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': MCP_ALLOWED_METHODS,
        'Access-Control-Allow-Headers': MCP_ALLOWED_HEADERS,
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Liveness probe for scanners that verify the streamable HTTP endpoint
    // before issuing JSON-RPC requests.
    if (req.method === 'HEAD' && url.pathname === MCP_PATH) {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': MCP_ALLOWED_METHODS,
        'Access-Control-Allow-Headers': MCP_ALLOWED_HEADERS,
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end();
      logAudit({
        timestamp: new Date().toISOString(),
        requestId,
        ip,
        method: 'HEAD',
        path: MCP_PATH,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // ChatGPT uses the widget origin as a fallback for "Open in app".
    // Keep its root shopper-facing; readiness lives at /health.
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(302, { Location: 'https://ogabassey.com' });
      res.end();
      logAudit({
        timestamp: new Date().toISOString(),
        requestId,
        ip,
        method: 'GET',
        path: '/',
        statusCode: 302,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // Readiness probe
    if (req.method === 'GET' && url.pathname === '/health') {
      try {
        const merchantId = await getMerchantId();
        if (merchantId) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', database: 'connected' }));
        } else {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'unhealthy',
              database: 'merchant not found',
            })
          );
        }
      } catch {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ status: 'unhealthy', database: 'connection failed' })
        );
      }
      return;
    }

    // OpenAI Domain Verification
    if (req.method === 'GET' && url.pathname === '/.well-known/openai-apps-challenge') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hpAeivM-F3G9_j9zte4YtD-0zugwbDAHBW0OcdxplWQ');
      logAudit({
        timestamp: new Date().toISOString(),
        requestId,
        ip,
        method: 'GET',
        path: '/.well-known/openai-apps-challenge',
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // Widget render endpoint for ChatGPT
    if (req.method === 'GET' && url.pathname.startsWith('/mcp/render/')) {
      // Serve widget HTML for ChatGPT to render
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/html+skybridge; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.writeHead(200);
      res.end(premiumWidgetHtml);
      logAudit({
        timestamp: new Date().toISOString(),
        requestId,
        ip,
        method: 'GET',
        path: url.pathname,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // MCP endpoint
    const MCP_METHODS = new Set(['POST', 'GET', 'DELETE']);
    if (
      url.pathname === MCP_PATH &&
      req.method &&
      MCP_METHODS.has(req.method)
    ) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', MCP_ALLOWED_HEADERS);
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      const server = createOgabasseyServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on('close', () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
        logAudit({
          timestamp: new Date().toISOString(),
          requestId,
          ip,
          method: req.method,
          path: MCP_PATH,
          statusCode: 200,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logError(requestId, error);
        logAudit({
          timestamp: new Date().toISOString(),
          requestId,
          ip,
          method: req.method,
          path: MCP_PATH,
          statusCode: 500,
          durationMs: Date.now() - startTime,
          error: 'MCP error',
        });
        if (!res.headersSent) {
          res.writeHead(500).end('Internal Server Error');
        }
      }
      return;
    }

    // 404 for everything else
    logAudit({
      timestamp: new Date().toISOString(),
      requestId,
      ip,
      method: req.method || 'UNKNOWN',
      path: url.pathname,
      statusCode: 404,
      durationMs: Date.now() - startTime,
    });
    res.writeHead(404).end('Not Found');
  }
);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(
    JSON.stringify({
      type: 'lifecycle',
      event: 'shutdown',
      timestamp: new Date().toISOString(),
    })
  );
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log(
    JSON.stringify({
      type: 'lifecycle',
      event: 'shutdown',
      timestamp: new Date().toISOString(),
    })
  );
  httpServer.close(() => process.exit(0));
});

// Unhandled rejection handler (fail closed - log and continue)
process.on('unhandledRejection', (reason) => {
  console.error(
    JSON.stringify({
      type: 'unhandledRejection',
      reason: String(reason),
      timestamp: new Date().toISOString(),
    })
  );
});

httpServer.listen(PORT, () => {
  const address = httpServer.address();
  const actualPort =
    typeof address === 'object' && address !== null ? address.port : PORT;

  console.log(
    JSON.stringify({
      type: 'lifecycle',
      event: 'startup',
      port: actualPort,
      timestamp: new Date().toISOString(),
    })
  );
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║     Ogabassey ChatGPT MCP Server (Production)                  ║
╠════════════════════════════════════════════════════════════════╣
║  Status:    Running                                            ║
║  Port:      ${actualPort}                                                ║
║  Endpoint:  https://mcp.ogabassey.com/mcp                      ║
╠════════════════════════════════════════════════════════════════╣
║  Security Features:                                            ║
║    • Rate limiting (${RATE_LIMIT_MAX_REQUESTS} req/min per IP)                     ║
║    • Input validation & sanitization                           ║
║    • Audit logging (JSON structured)                           ║
║    • Security headers (CSP, XSS, etc.)                         ║
║    • Request timeout (${REQUEST_TIMEOUT_MS / 1000}s)                                 ║
║    • Graceful shutdown                                         ║
╚════════════════════════════════════════════════════════════════╝
`);
});
