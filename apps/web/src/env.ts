// src/env.ts
import z from 'zod';
import { DEFAULT_ROOT_DOMAIN } from '@/lib/default-root-domain';
import { normalizeEnvBoolean } from '@/lib/env-boolean';
import { buildLlmBearerAuthHeader } from '@/lib/llm-auth';
import { isNegotiatedCheckoutProofSecretMissing } from '@/lib/quiz/negotiated-checkout-proof-env';
import { supabaseAgenticJwtPrivateJwkStringSchema } from '@/schemas/supabase-agentic-jwt-private-jwk';

/**
 * A type-safe and validated way to access environment variables.
 * This is the single source of truth for all environment variables in the app.
 *
 * 2026 Best Practice: Schema-based validation using Zod.
 */

const booleanStringSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const quizProductionApprovedSchema = z.preprocess((value) => {
  if (value === undefined) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeEnvBoolean(trimmed);
  if (normalized !== undefined) return normalized;

  // Keep invalid strings unchanged so z.boolean().default(false) reports
  // the standard type error for malformed QUIZ_PRODUCTION_APPROVED values.
  return value;
}, z.boolean().default(false));

const quizIntegrityTierSchema = z.enum(['basic', 'device', 'strong']);
const quizIntegrityTierOverridesSchema = z.preprocess((value) => {
  if (value === undefined) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}, z.record(z.string().min(1), quizIntegrityTierSchema).optional());
type QuizIntegrityTierOverrides = z.infer<
  typeof quizIntegrityTierOverridesSchema
>;

const defaultFalseBooleanStringSchema = z.preprocess((value) => {
  if (value === undefined) return false;
  if (typeof value !== 'string') return value;

  return normalizeEnvBoolean(value) ?? value;
}, z.boolean());

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}, z.string().trim().min(1).optional());

const defaultedTrimmedStringSchema = (defaultValue: string) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().trim().min(1).default(defaultValue));

const optionalTrimmedUrlSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}, z.url().optional());

const recoveryCodePepperSchema = optionalTrimmedStringSchema.refine(
  (value) => value === undefined || value.length >= 32,
  { message: 'RECOVERY_CODE_PEPPER must be at least 32 characters' }
);
const quizDeviceHashPepperSchema = optionalTrimmedStringSchema.refine(
  (value) => value === undefined || value.length >= 32,
  { message: 'QUIZ_DEVICE_HASH_PEPPER must be at least 32 characters' }
);

const ENV_VALUE_LINE_BREAK_PATTERN = /\\n|\r?\n|\r/g;

const aiChatProviderSchema = z.preprocess(
  (value) => {
    if (value === undefined) return value;
    if (typeof value !== 'string') return value;

    const trimmed = value
      .replace(ENV_VALUE_LINE_BREAK_PATTERN, '')
      .trim()
      .toLowerCase();
    return trimmed || undefined;
  },
  z.enum(['auto', 'gemini', 'llm', 'ollama']).default('auto')
);
export type AiChatProvider = z.infer<typeof aiChatProviderSchema>;

const DEFAULT_CAC_API_URL =
  'https://authapp.cac.gov.ng/name_similarity_app/api/public_search/search';
const DEFAULT_CAC_TIN_API_BASE_URL =
  'https://icrp.cac.gov.ng/tin_service/api/v1/public/tin';
const DEFAULT_TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Strict 127.0.0.0/8 hostname matcher. Anchored regex on the URL `hostname`
 * (already brackets-stripped by the `URL` parser) so only true IPv4 loopback
 * literals match — `127.example.com`, `127malicious`, `127.0.0.1.evil.com`
 * are all rejected. Each octet is 0–255; the first is fixed at 127.
 */
const IPV4_LOOPBACK_REGEX =
  /^127\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

/**
 * Returns true for URLs that are safe to reach from this server:
 *   - `https://...` for any host
 *   - `http://...` for loopback only (localhost, 127.0.0.0/8, ::1)
 *
 * The loopback exception is restricted to the `http:` scheme so callers
 * cannot smuggle `ftp://localhost` or `file://127.0.0.1` past the check.
 * Invalid URLs return false rather than throwing so the surrounding Zod
 * refine produces a clean validation error.
 *
 * Exported for direct unit testing — the schema below wraps it for reuse.
 */
export function isAllowedLlmServerUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const protocol = parsed.protocol;
  // `new URL('http://[::1]:11500').hostname` returns the unbracketed form
  // '::1' in spec-compliant runtimes (Node ≥18, modern browsers). Older
  // runtimes returned '[::1]'; accept both defensively. Lowercase to make
  // 'LOCALHOST' / 'Localhost' equivalent to 'localhost'.
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    IPV4_LOOPBACK_REGEX.test(host);

  if (isLoopback) {
    // HTTPS on loopback is also fine — it's strictly tighter than HTTP.
    return protocol === 'http:' || protocol === 'https:';
  }

  return protocol === 'https:';
}

/**
 * URL schema that allows HTTP only when pointed at a loopback host.
 * Reused by every "self-hosted backend on a known host" env var (Ollama,
 * llama-server, etc.) so the policy is enforced consistently and a future
 * tweak (e.g. allow `.localhost` TLD or unix sockets) lands in one place.
 */
function httpsOrLocalhostUrl(name: string) {
  return z
    .string()
    .url()
    .refine(isAllowedLlmServerUrl, {
      message: `${name} must use HTTPS (except for http:// on loopback)`,
    });
}

const serverSchema = z
  .object({
    // Supabase (Server Admin)
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    RECOVERY_CODE_PEPPER: recoveryCodePepperSchema,
    SUPABASE_JWT_SECRET: optionalTrimmedStringSchema,
    SUPABASE_LEGACY_ANON_JWT: optionalTrimmedStringSchema,
    SUPABASE_AGENTIC_JWT_PRIVATE_JWK: supabaseAgenticJwtPrivateJwkStringSchema,

    // Blog
    BLOG_PREVIEW_SECRET: z.string().default('dev-preview-secret'), // Fallback for dev
    INDEXNOW_KEY: optionalTrimmedStringSchema,
    INDEXNOW_ENDPOINT: optionalTrimmedUrlSchema,

    // Payments (Server keys)
    KLUMP_SECRET_KEY: optionalTrimmedStringSchema,
    KLUMP_WEBHOOK_SECRET: optionalTrimmedStringSchema,
    KORAPAY_SECRET_KEY: z.string().optional(),
    JUICYWAY_SECRET_KEY: z.string().optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    BACI_CDN_ORIGIN_FETCH_SECRET: optionalTrimmedStringSchema,
    BACI_GOOGLE_PAY_ENABLED: z.string().optional(),
    BACI_GOOGLE_PAY_GATEWAY: z.string().optional(),
    BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID: z.string().optional(),
    BACI_GOOGLE_PAY_MERCHANT_ID: z.string().optional(),
    SICKW_API_KEY: optionalTrimmedStringSchema,
    IMEI_HASH_SALT: optionalTrimmedStringSchema,
    IMEI_DISABLED_TIERS: optionalTrimmedStringSchema,
    IMEI_IDENTIFIER_ENCRYPTION_KEY: optionalTrimmedStringSchema,
    PETROCK_API_BASE_URL: optionalTrimmedUrlSchema,
    PETROCK_API_TOKEN: optionalTrimmedStringSchema,
    PETROCK_ENABLED: defaultFalseBooleanStringSchema,
    PETROCK_ENABLED_TIERS: optionalTrimmedStringSchema,
    PETROCK_REMEDIATION_ENABLED: defaultFalseBooleanStringSchema,
    USDT_WALLET_ENABLED: defaultFalseBooleanStringSchema,
    WALLET_CREDIT_PUSH_ENABLED: defaultFalseBooleanStringSchema,
    IMEI_FX_NGN_USD: z.coerce.number().positive().optional(),
    BACI_AGENTIC_ACCESS_TOKEN: z.string().optional(),
    BACI_AGENTIC_ACCESS_TOKEN_PREVIOUS: z.string().optional(),
    BACI_AGENTIC_CONFIRMATION_KEY: z.string().optional(),
    BACI_AGENTIC_CONFIRMATION_KEY_PREVIOUS: z.string().optional(),
    BACI_AGENTIC_MERCHANT_SLUG: z.string().optional(),
    BACI_AGENTIC_SIGNING_KEY: z.string().optional(),
    BACI_AGENTIC_SIGNING_KEY_PREVIOUS: z.string().optional(),
    OPENAI_AGENTIC_API_KEY: z.string().optional(),
    OPENAI_AGENTIC_API_KEY_PREVIOUS: z.string().optional(),
    OPENAI_AGENTIC_CONFIRMATION_KEY: z.string().optional(),
    OPENAI_AGENTIC_CONFIRMATION_KEY_PREVIOUS: z.string().optional(),
    OPENAI_AGENTIC_MERCHANT_SLUG: z.string().optional(),
    OPENAI_AGENTIC_SIGNING_KEY: z.string().optional(),
    OPENAI_AGENTIC_SIGNING_KEY_PREVIOUS: z.string().optional(),
    OGABASSEY_AGENT_ORIGIN: optionalTrimmedUrlSchema,
    MCP_PUBLIC_SERVER_URL: optionalTrimmedUrlSchema,
    MCP_PUBLIC_HEALTH_URL: optionalTrimmedUrlSchema,
    WEB_BOT_AUTH_PUBLIC_JWKS_JSON: optionalTrimmedStringSchema,
    WEB_BOT_AUTH_PRIVATE_KEY_PEM: optionalTrimmedStringSchema,

    // Debug
    KUDA_BILL_DEBUG: z.string().optional(),

    // Email
    ZEPTOMAIL_TOKEN: z.string().optional(),
    ZEPTOMAIL_FROM_DOMAIN: z.string().optional(),
    // ZeptoMail Domains API (per-merchant custom sending domains). Zoho OAuth
    // self-client with scope Zeptomail.Domains.All.
    ZOHO_CLIENT_ID: optionalTrimmedStringSchema,
    ZOHO_CLIENT_SECRET: optionalTrimmedStringSchema,
    ZOHO_REFRESH_TOKEN: optionalTrimmedStringSchema,
    ZEPTOMAIL_MAILAGENT_KEY: optionalTrimmedStringSchema,

    // Zoho Campaigns
    ZOHO_CAMPAIGNS_ENABLED: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_AUTO_SEND: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_CLIENT_ID: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_CLIENT_SECRET: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_OAUTH_STATE: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_CONTENT_SECRET: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_ACCOUNTS_SERVER_URL: optionalTrimmedUrlSchema,
    ZOHO_CAMPAIGNS_API_ROOT_URL: optionalTrimmedUrlSchema,
    ZOHO_CAMPAIGNS_REDIRECT_URI: optionalTrimmedUrlSchema,
    ZOHO_CAMPAIGNS_PUBLIC_BASE_URL: optionalTrimmedUrlSchema,
    ZOHO_CAMPAIGNS_FROM_NAME: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_TOPIC_ID: optionalTrimmedStringSchema,
    ZOHO_CAMPAIGNS_REQUEST_TIMEOUT_MS: optionalTrimmedStringSchema,

    // AI
    GOOGLE_GENAI_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GOOGLE_MAPS_API_KEY: optionalTrimmedStringSchema,
    GOOGLE_PLACES_API_KEY: optionalTrimmedStringSchema,
    AI_CHAT_MODEL: z.string().default('gemma4:e4b'),
    AI_CHAT_PROVIDER: aiChatProviderSchema,

    // BNPL
    CREDIT_DIRECT_PRIVATE_KEY: z.string().optional(),

    // Node Env
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // Internal
    JUICYWAY_BASE_URL: z.string().default('https://api.spendjuice.com'),
    MYCOVER_WEBHOOK_SECRET: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    INTERNAL_API_SECRET: z.string().optional(),
    // Cloudflare cache purge (edge in front of the storefront custom domains).
    // Both must be set for active purge; when either is absent the purge helper
    // fails open (logs once) and caches self-heal on their TTL.
    CLOUDFLARE_API_TOKEN: optionalTrimmedStringSchema,
    CLOUDFLARE_ZONE_ID: optionalTrimmedStringSchema,
    // App Store Connect API (read-only) — used by the ios-live-build-sync cron
    // to learn which build is actually live on the App Store.
    ASC_API_KEY_ID: z.string().optional(),
    ASC_API_ISSUER_ID: z.string().optional(),
    ASC_API_PRIVATE_KEY: z.string().optional(),
    APP_STORE_CONNECT_BUNDLE_ID:
      defaultedTrimmedStringSchema('com.ogabassey.app'),
    APP_STORE_CONNECT_ADMIN_BUNDLE_ID:
      defaultedTrimmedStringSchema('com.ogabassey.baci'),
    // Google Play Developer API (read-only) — used by the
    // android-live-build-sync cron to learn which versionCode is actually live
    // on the Play production track before the in-app update gate advances.
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: optionalTrimmedStringSchema,
    GOOGLE_PLAY_PACKAGE_NAME: defaultedTrimmedStringSchema(
      'com.ogabassey.store'
    ),
    GOOGLE_PLAY_ADMIN_PACKAGE_NAME:
      defaultedTrimmedStringSchema('com.ogabassey.baci'),
    // Secrets configured when registering each App Store Connect webhook; used
    // to verify the X-Apple-Signature HMAC on inbound webhook deliveries.
    APP_STORE_CONNECT_WEBHOOK_SECRET: optionalTrimmedStringSchema,
    APP_STORE_CONNECT_ADMIN_WEBHOOK_SECRET: optionalTrimmedStringSchema,
    IMPORT_JOB_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(3),
    IMPORT_JOB_DIRECT_UPLOAD_ENABLED: booleanStringSchema.optional(),
    IMPORT_JOB_TRIGGER_URL: httpsOrLocalhostUrl(
      'IMPORT_JOB_TRIGGER_URL'
    ).optional(),
    IMPORT_JOB_TRIGGER_SECRET: optionalTrimmedStringSchema,
    IMPORT_JOB_TRIGGER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5000),
    TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS),

    // Quiz
    // QUIZ_PHASE accepts "1a" (default, fail-closed prize stubs) or
    // "production" (requires QUIZ_RPC_SERVER_SECRET and prize approval gates).
    // QUIZ_PRODUCTION_APPROVED uses normalizeEnvBoolean:
    // true/1/yes enable production prize mutations; false/0/no disable them.
    // QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON is an optional JSON object whose
    // keys are quiz event ids and values are "basic", "device", or "strong";
    // for example: {"event-id":"strong"}.
    QUIZ_PHASE: z.enum(['1a', 'production']).default('1a'),
    QUIZ_PRODUCTION_APPROVED: quizProductionApprovedSchema,
    QUIZ_RPC_SERVER_SECRET: optionalTrimmedStringSchema,
    QUIZ_DEVICE_HASH_PEPPER: quizDeviceHashPepperSchema,
    QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON: quizIntegrityTierOverridesSchema,

    // Push Notifications
    EXPO_ACCESS_TOKEN: z.string().optional(),

    // Monnify (Identity verification)
    MONNIFY_API_KEY: z.string().optional(),
    MONNIFY_SECRET_KEY: z.string().optional(),
    MONNIFY_BASE_URL: z.url().default('https://api.monnify.com'),
    CAC_API_URL: z.url().default(DEFAULT_CAC_API_URL),
    CAC_TIN_API_BASE_URL: z
      .string()
      .url()
      .default(DEFAULT_CAC_TIN_API_BASE_URL),
    // Ollama (CAC certificate OCR — Gemma 4 on VPS)
    OLLAMA_BASE_URL: httpsOrLocalhostUrl('OLLAMA_BASE_URL').optional(),
    OLLAMA_CAC_MODEL: z.string().default('gemma4:e4b'),
    OLLAMA_BASIC_AUTH: z.string().optional(),
    OLLAMA_STOREFRONT_BASE_URL: httpsOrLocalhostUrl(
      'OLLAMA_STOREFRONT_BASE_URL'
    ).optional(),
    OLLAMA_STOREFRONT_BASIC_AUTH: z.string().optional(),
    OLLAMA_STOREFRONT_MODEL: z.string().default('gemma4:e4b'),
    OLLAMA_STOREFRONT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(90_000),
    AI_STOREFRONT_GENERATION_ENABLED: defaultFalseBooleanStringSchema,
    AI_STOREFRONT_TRIGGER_URL: httpsOrLocalhostUrl(
      'AI_STOREFRONT_TRIGGER_URL'
    ).optional(),
    AI_STOREFRONT_TRIGGER_SECRET: optionalTrimmedStringSchema,
    AI_STOREFRONT_TRIGGER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5000),

    // LLM server (llama.cpp / OpenAI-compatible — Gemma 4 + MTP drafter on VPS)
    LLM_SERVER_URL: httpsOrLocalhostUrl('LLM_SERVER_URL').optional(),
    // Blank placeholders are treated as unset; the superRefine below requires
    // a real bearer only when LLM_SERVER_URL is configured.
    LLM_SERVER_BEARER: optionalTrimmedStringSchema.refine(
      (value) =>
        value === undefined || buildLlmBearerAuthHeader(value) !== null,
      {
        message:
          'LLM_SERVER_BEARER must be a valid bearer token (no control chars, ≤2048 chars, not "BearerXyz")',
      }
    ),
    LLM_CHAT_MODEL: z.string().default('gemma4:e4b'),

    // Jumia Marketplace
    JUMIA_ENVIRONMENT: z.enum(['staging', 'production']).default('staging'),
    JUMIA_CLIENT_ID: z.string().optional(),
    JUMIA_CLIENT_SECRET: z.string().optional(),
    JUMIA_AUTHORIZATION_ENCRYPTION_KEY: optionalTrimmedStringSchema.refine(
      (value) =>
        value === undefined || Buffer.from(value, 'base64').length === 32,
      {
        message:
          'JUMIA_AUTHORIZATION_ENCRYPTION_KEY must be Base64-encoded 32 bytes',
      }
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const isGitHubActionsBuild =
      process.env.GITHUB_ACTIONS === 'true' &&
      Boolean(process.env.GITHUB_RUN_ID) &&
      Boolean(process.env.GITHUB_REPOSITORY);
    // These bounded VPS workers never sign agentic JWTs, so they should not
    // fail boot on unrelated signing material.
    const isNonAgenticWorker = [
      'ai-storefront-jobs',
      'event-pipeline',
      'petrock-reconciliation',
      'quiz-finalization',
    ].includes(process.env.BACI_WORKER_PROFILE ?? '');

    if (
      value.NODE_ENV !== 'production' ||
      isGitHubActionsBuild ||
      isNonAgenticWorker ||
      value.SUPABASE_AGENTIC_JWT_PRIVATE_JWK ||
      value.SUPABASE_JWT_SECRET
    ) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'SUPABASE_AGENTIC_JWT_PRIVATE_JWK or SUPABASE_JWT_SECRET is required in production',
      path: ['SUPABASE_AGENTIC_JWT_PRIVATE_JWK'],
    });
  })
  .superRefine((value, ctx) => {
    if (value.QUIZ_PHASE === 'production' && !value.QUIZ_RPC_SERVER_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'QUIZ_RPC_SERVER_SECRET is required when QUIZ_PHASE is production',
        path: ['QUIZ_RPC_SERVER_SECRET'],
      });
    }
  })
  .superRefine((value, ctx) => {
    if (isNegotiatedCheckoutProofSecretMissing(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'QUIZ_RPC_SERVER_SECRET is required in production for negotiated checkout proofs',
        path: ['QUIZ_RPC_SERVER_SECRET'],
      });
    }
  })
  .superRefine((value, ctx) => {
    if (value.QUIZ_PHASE === 'production' && !value.QUIZ_DEVICE_HASH_PEPPER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'QUIZ_DEVICE_HASH_PEPPER is required when QUIZ_PHASE is production',
        path: ['QUIZ_DEVICE_HASH_PEPPER'],
      });
    }
  })
  .superRefine((value, ctx) => {
    if (
      process.env.NEXT_PUBLIC_SUPABASE_PASSKEY_AUTH_ENABLED === 'true' &&
      !value.RECOVERY_CODE_PEPPER
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'RECOVERY_CODE_PEPPER is required when passkey recovery codes are enabled',
        path: ['RECOVERY_CODE_PEPPER'],
      });
    }
  })
  .superRefine((value, ctx) => {
    if (
      value.AI_STOREFRONT_TRIGGER_URL &&
      !value.AI_STOREFRONT_TRIGGER_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'AI_STOREFRONT_TRIGGER_SECRET is required when AI_STOREFRONT_TRIGGER_URL is set',
        path: ['AI_STOREFRONT_TRIGGER_SECRET'],
      });
    }
    if (
      value.AI_STOREFRONT_TRIGGER_SECRET &&
      !value.AI_STOREFRONT_TRIGGER_URL
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'AI_STOREFRONT_TRIGGER_URL is required when AI_STOREFRONT_TRIGGER_SECRET is set',
        path: ['AI_STOREFRONT_TRIGGER_URL'],
      });
    }
  })
  .superRefine((value, ctx) => {
    if (value.IMPORT_JOB_TRIGGER_URL && !value.IMPORT_JOB_TRIGGER_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'IMPORT_JOB_TRIGGER_SECRET is required when IMPORT_JOB_TRIGGER_URL is set',
        path: ['IMPORT_JOB_TRIGGER_SECRET'],
      });
    }
    if (value.IMPORT_JOB_TRIGGER_SECRET && !value.IMPORT_JOB_TRIGGER_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'IMPORT_JOB_TRIGGER_URL is required when IMPORT_JOB_TRIGGER_SECRET is set',
        path: ['IMPORT_JOB_TRIGGER_URL'],
      });
    }
  })
  .superRefine((value, ctx) => {
    if (value.LLM_SERVER_URL && !value.LLM_SERVER_BEARER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LLM_SERVER_BEARER is required when LLM_SERVER_URL is set',
        path: ['LLM_SERVER_BEARER'],
      });
    }
  });

const clientSchema = z.object({
  // Supabase (Public)
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_URL is required'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),

  // App
  NEXT_PUBLIC_ROOT_DOMAIN: z.string().default(DEFAULT_ROOT_DOMAIN),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:', {
      message: 'CDN origin must use HTTPS',
    })
    .optional(),
  NEXT_PUBLIC_MCP_SERVER_URL: optionalTrimmedUrlSchema,
  NEXT_PUBLIC_MCP_HEALTH_URL: optionalTrimmedUrlSchema,

  // Payments (Public keys)
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: z.string().optional(),
  KORAPAY_PUBLIC_KEY: z.string().optional(), // Ideally should be NEXT_PUBLIC_ but keeping legacy name for compatibility
  CREDIT_DIRECT_PUBLIC_KEY: z.string().optional(),
});

// Helper to format validation errors
const formatErrors = (
  errors: z.ZodFormattedError<Map<string, string>, string>
) =>
  Object.entries(errors)
    .map(([name, value]) => {
      if (value && '_errors' in value)
        return `${name}: ${value._errors.join(', ')}`;
      return null;
    })
    .filter(Boolean);

const validateSanitizedModel = (
  value: string | undefined,
  name: string
): string => {
  const model = value?.replace(ENV_VALUE_LINE_BREAK_PATTERN, '').trim() ?? '';

  if (!model) {
    throw new Error(`${name} must resolve to a non-empty model name`);
  }

  return model;
};

/**
 * Validates and returns the environment variables.
 * Throws an error in non-production environments if validation fails.
 * In production, it logs errors but might allow the app to crash downstream if critical keys are missing.
 */
const getEnv = () => {
  const isServer = typeof window === 'undefined';

  // Explicitly map client variables to ensure they are available on the client
  // Next.js requires the full process.env.NEXT_PUBLIC_* string for bundling
  const clientEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN:
      process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN,
    NEXT_PUBLIC_MCP_SERVER_URL: process.env.NEXT_PUBLIC_MCP_SERVER_URL,
    NEXT_PUBLIC_MCP_HEALTH_URL: process.env.NEXT_PUBLIC_MCP_HEALTH_URL,
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:
      process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
    KORAPAY_PUBLIC_KEY: process.env.KORAPAY_PUBLIC_KEY,
    CREDIT_DIRECT_PUBLIC_KEY: process.env.CREDIT_DIRECT_PUBLIC_KEY,
  };

  const serverEnv = isServer
    ? {
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        RECOVERY_CODE_PEPPER: process.env.RECOVERY_CODE_PEPPER,
        SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
        SUPABASE_LEGACY_ANON_JWT: process.env.SUPABASE_LEGACY_ANON_JWT,
        SUPABASE_AGENTIC_JWT_PRIVATE_JWK:
          process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK,
        BLOG_PREVIEW_SECRET: process.env.BLOG_PREVIEW_SECRET,
        INDEXNOW_KEY: process.env.INDEXNOW_KEY,
        INDEXNOW_ENDPOINT: process.env.INDEXNOW_ENDPOINT,
        KLUMP_SECRET_KEY: process.env.KLUMP_SECRET_KEY,
        KLUMP_WEBHOOK_SECRET: process.env.KLUMP_WEBHOOK_SECRET,
        KORAPAY_SECRET_KEY: process.env.KORAPAY_SECRET_KEY,
        JUICYWAY_SECRET_KEY: process.env.JUICYWAY_SECRET_KEY,
        PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
        BACI_CDN_ORIGIN_FETCH_SECRET: process.env.BACI_CDN_ORIGIN_FETCH_SECRET,
        BACI_GOOGLE_PAY_ENABLED: process.env.BACI_GOOGLE_PAY_ENABLED,
        BACI_GOOGLE_PAY_GATEWAY: process.env.BACI_GOOGLE_PAY_GATEWAY,
        BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID:
          process.env.BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID,
        BACI_GOOGLE_PAY_MERCHANT_ID: process.env.BACI_GOOGLE_PAY_MERCHANT_ID,
        SICKW_API_KEY: process.env.SICKW_API_KEY,
        IMEI_HASH_SALT: process.env.IMEI_HASH_SALT,
        IMEI_DISABLED_TIERS: process.env.IMEI_DISABLED_TIERS,
        IMEI_IDENTIFIER_ENCRYPTION_KEY:
          process.env.IMEI_IDENTIFIER_ENCRYPTION_KEY,
        PETROCK_API_BASE_URL: process.env.PETROCK_API_BASE_URL,
        PETROCK_API_TOKEN: process.env.PETROCK_API_TOKEN,
        PETROCK_ENABLED: process.env.PETROCK_ENABLED,
        PETROCK_ENABLED_TIERS: process.env.PETROCK_ENABLED_TIERS,
        PETROCK_REMEDIATION_ENABLED: process.env.PETROCK_REMEDIATION_ENABLED,
        USDT_WALLET_ENABLED: process.env.USDT_WALLET_ENABLED,
        WALLET_CREDIT_PUSH_ENABLED: process.env.WALLET_CREDIT_PUSH_ENABLED,
        IMEI_FX_NGN_USD: process.env.IMEI_FX_NGN_USD,
        KUDA_BILL_DEBUG: process.env.KUDA_BILL_DEBUG,
        BACI_AGENTIC_ACCESS_TOKEN: process.env.BACI_AGENTIC_ACCESS_TOKEN,
        BACI_AGENTIC_ACCESS_TOKEN_PREVIOUS:
          process.env.BACI_AGENTIC_ACCESS_TOKEN_PREVIOUS,
        BACI_AGENTIC_CONFIRMATION_KEY:
          process.env.BACI_AGENTIC_CONFIRMATION_KEY,
        BACI_AGENTIC_CONFIRMATION_KEY_PREVIOUS:
          process.env.BACI_AGENTIC_CONFIRMATION_KEY_PREVIOUS,
        BACI_AGENTIC_MERCHANT_SLUG: process.env.BACI_AGENTIC_MERCHANT_SLUG,
        BACI_AGENTIC_SIGNING_KEY: process.env.BACI_AGENTIC_SIGNING_KEY,
        BACI_AGENTIC_SIGNING_KEY_PREVIOUS:
          process.env.BACI_AGENTIC_SIGNING_KEY_PREVIOUS,
        OPENAI_AGENTIC_API_KEY: process.env.OPENAI_AGENTIC_API_KEY,
        OPENAI_AGENTIC_API_KEY_PREVIOUS:
          process.env.OPENAI_AGENTIC_API_KEY_PREVIOUS,
        OPENAI_AGENTIC_CONFIRMATION_KEY:
          process.env.OPENAI_AGENTIC_CONFIRMATION_KEY,
        OPENAI_AGENTIC_CONFIRMATION_KEY_PREVIOUS:
          process.env.OPENAI_AGENTIC_CONFIRMATION_KEY_PREVIOUS,
        OPENAI_AGENTIC_MERCHANT_SLUG: process.env.OPENAI_AGENTIC_MERCHANT_SLUG,
        OPENAI_AGENTIC_SIGNING_KEY: process.env.OPENAI_AGENTIC_SIGNING_KEY,
        OPENAI_AGENTIC_SIGNING_KEY_PREVIOUS:
          process.env.OPENAI_AGENTIC_SIGNING_KEY_PREVIOUS,
        OGABASSEY_AGENT_ORIGIN: process.env.OGABASSEY_AGENT_ORIGIN,
        MCP_PUBLIC_SERVER_URL: process.env.MCP_PUBLIC_SERVER_URL,
        MCP_PUBLIC_HEALTH_URL: process.env.MCP_PUBLIC_HEALTH_URL,
        WEB_BOT_AUTH_PUBLIC_JWKS_JSON:
          process.env.WEB_BOT_AUTH_PUBLIC_JWKS_JSON,
        WEB_BOT_AUTH_PRIVATE_KEY_PEM: process.env.WEB_BOT_AUTH_PRIVATE_KEY_PEM,
        ZEPTOMAIL_TOKEN: process.env.ZEPTOMAIL_TOKEN,
        ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID,
        ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
        ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
        ZEPTOMAIL_MAILAGENT_KEY: process.env.ZEPTOMAIL_MAILAGENT_KEY,
        ZEPTOMAIL_FROM_DOMAIN: process.env.ZEPTOMAIL_FROM_DOMAIN,
        ZOHO_CAMPAIGNS_ENABLED: process.env.ZOHO_CAMPAIGNS_ENABLED,
        ZOHO_CAMPAIGNS_AUTO_SEND: process.env.ZOHO_CAMPAIGNS_AUTO_SEND,
        ZOHO_CAMPAIGNS_CLIENT_ID: process.env.ZOHO_CAMPAIGNS_CLIENT_ID,
        ZOHO_CAMPAIGNS_CLIENT_SECRET: process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET,
        ZOHO_CAMPAIGNS_OAUTH_STATE: process.env.ZOHO_CAMPAIGNS_OAUTH_STATE,
        ZOHO_CAMPAIGNS_CONTENT_SECRET:
          process.env.ZOHO_CAMPAIGNS_CONTENT_SECRET,
        ZOHO_CAMPAIGNS_ACCOUNTS_SERVER_URL:
          process.env.ZOHO_CAMPAIGNS_ACCOUNTS_SERVER_URL,
        ZOHO_CAMPAIGNS_API_ROOT_URL: process.env.ZOHO_CAMPAIGNS_API_ROOT_URL,
        ZOHO_CAMPAIGNS_REDIRECT_URI: process.env.ZOHO_CAMPAIGNS_REDIRECT_URI,
        ZOHO_CAMPAIGNS_PUBLIC_BASE_URL:
          process.env.ZOHO_CAMPAIGNS_PUBLIC_BASE_URL,
        ZOHO_CAMPAIGNS_FROM_NAME: process.env.ZOHO_CAMPAIGNS_FROM_NAME,
        ZOHO_CAMPAIGNS_TOPIC_ID: process.env.ZOHO_CAMPAIGNS_TOPIC_ID,
        ZOHO_CAMPAIGNS_REQUEST_TIMEOUT_MS:
          process.env.ZOHO_CAMPAIGNS_REQUEST_TIMEOUT_MS,
        GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
        GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
        AI_CHAT_MODEL: process.env.AI_CHAT_MODEL,
        AI_CHAT_PROVIDER: process.env.AI_CHAT_PROVIDER,
        CREDIT_DIRECT_PRIVATE_KEY: process.env.CREDIT_DIRECT_PRIVATE_KEY,
        NODE_ENV: process.env.NODE_ENV,
        JUICYWAY_BASE_URL: process.env.JUICYWAY_BASE_URL,
        MYCOVER_WEBHOOK_SECRET: process.env.MYCOVER_WEBHOOK_SECRET,
        CRON_SECRET: process.env.CRON_SECRET,
        ASC_API_KEY_ID: process.env.ASC_API_KEY_ID,
        ASC_API_ISSUER_ID: process.env.ASC_API_ISSUER_ID,
        ASC_API_PRIVATE_KEY: process.env.ASC_API_PRIVATE_KEY,
        APP_STORE_CONNECT_BUNDLE_ID: process.env.APP_STORE_CONNECT_BUNDLE_ID,
        APP_STORE_CONNECT_ADMIN_BUNDLE_ID:
          process.env.APP_STORE_CONNECT_ADMIN_BUNDLE_ID,
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:
          process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
        GOOGLE_PLAY_PACKAGE_NAME: process.env.GOOGLE_PLAY_PACKAGE_NAME,
        GOOGLE_PLAY_ADMIN_PACKAGE_NAME:
          process.env.GOOGLE_PLAY_ADMIN_PACKAGE_NAME,
        APP_STORE_CONNECT_WEBHOOK_SECRET:
          process.env.APP_STORE_CONNECT_WEBHOOK_SECRET,
        APP_STORE_CONNECT_ADMIN_WEBHOOK_SECRET:
          process.env.APP_STORE_CONNECT_ADMIN_WEBHOOK_SECRET,
        IMPORT_JOB_WORKER_BATCH_SIZE: process.env.IMPORT_JOB_WORKER_BATCH_SIZE,
        IMPORT_JOB_TRIGGER_URL: process.env.IMPORT_JOB_TRIGGER_URL,
        IMPORT_JOB_TRIGGER_SECRET: process.env.IMPORT_JOB_TRIGGER_SECRET,
        IMPORT_JOB_TRIGGER_TIMEOUT_MS:
          process.env.IMPORT_JOB_TRIGGER_TIMEOUT_MS,
        TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS:
          process.env.TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS,
        JUMIA_ENVIRONMENT: process.env.JUMIA_ENVIRONMENT,
        JUMIA_CLIENT_ID: process.env.JUMIA_CLIENT_ID,
        JUMIA_CLIENT_SECRET: process.env.JUMIA_CLIENT_SECRET,
        JUMIA_AUTHORIZATION_ENCRYPTION_KEY:
          process.env.JUMIA_AUTHORIZATION_ENCRYPTION_KEY,
        INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID,
        IMPORT_JOB_DIRECT_UPLOAD_ENABLED:
          process.env.IMPORT_JOB_DIRECT_UPLOAD_ENABLED,
        QUIZ_PHASE: process.env.QUIZ_PHASE,
        QUIZ_PRODUCTION_APPROVED: process.env.QUIZ_PRODUCTION_APPROVED,
        QUIZ_RPC_SERVER_SECRET: process.env.QUIZ_RPC_SERVER_SECRET,
        QUIZ_DEVICE_HASH_PEPPER: process.env.QUIZ_DEVICE_HASH_PEPPER,
        QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON:
          process.env.QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON,
        EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN,
        MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
        MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY,
        MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL,
        CAC_API_URL: process.env.CAC_API_URL,
        CAC_TIN_API_BASE_URL: process.env.CAC_TIN_API_BASE_URL,
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
        OLLAMA_CAC_MODEL: process.env.OLLAMA_CAC_MODEL,
        OLLAMA_BASIC_AUTH: process.env.OLLAMA_BASIC_AUTH,
        OLLAMA_STOREFRONT_BASE_URL: process.env.OLLAMA_STOREFRONT_BASE_URL,
        OLLAMA_STOREFRONT_BASIC_AUTH: process.env.OLLAMA_STOREFRONT_BASIC_AUTH,
        OLLAMA_STOREFRONT_MODEL: process.env.OLLAMA_STOREFRONT_MODEL,
        OLLAMA_STOREFRONT_TIMEOUT_MS: process.env.OLLAMA_STOREFRONT_TIMEOUT_MS,
        AI_STOREFRONT_GENERATION_ENABLED:
          process.env.AI_STOREFRONT_GENERATION_ENABLED,
        AI_STOREFRONT_TRIGGER_URL: process.env.AI_STOREFRONT_TRIGGER_URL,
        AI_STOREFRONT_TRIGGER_SECRET: process.env.AI_STOREFRONT_TRIGGER_SECRET,
        AI_STOREFRONT_TRIGGER_TIMEOUT_MS:
          process.env.AI_STOREFRONT_TRIGGER_TIMEOUT_MS,
        LLM_SERVER_URL: process.env.LLM_SERVER_URL,
        LLM_SERVER_BEARER: process.env.LLM_SERVER_BEARER,
        LLM_CHAT_MODEL: process.env.LLM_CHAT_MODEL,
      }
    : {};

  // Validate client side
  const parsedClient = clientSchema.safeParse(clientEnv);

  // Validate server side ONLY on the server
  let parsedServer = serverSchema.safeParse(serverEnv);

  if (!isServer) {
    // On client, we relax server validation (or just mock it)
    // We already know they are missing, so we just use empty defaults
    parsedServer = { success: true, data: {} as z.infer<typeof serverSchema> };
  }

  if (!parsedClient.success || (isServer && !parsedServer.success)) {
    const clientErrors = parsedClient.success
      ? []
      : formatErrors(parsedClient.error.format());
    const serverErrors =
      isServer && !parsedServer.success
        ? formatErrors(parsedServer.error.format())
        : [];

    const allErrors = [...clientErrors, ...serverErrors];

    if (allErrors.length > 0) {
      console.error('❌ Invalid environment variables:', allErrors.join('\n'));

      // In production, we strictly throw.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `❌ Invalid environment variables: ${allErrors.join(', ')}`
        );
      }
    }
  }

  return {
    ...(parsedServer.success ? parsedServer.data : {}),
    ...(parsedClient.success ? parsedClient.data : {}),
  } as z.infer<typeof serverSchema> & z.infer<typeof clientSchema>;
};

// Singleton env object
// Note: We use a lazy getter pattern or just executed immediately.
// For Next.js/Edge, immediate execution is usually fine, but safeParse handles the "build time" vs "runtime" nuance better.
export const env = getEnv();

/**
 * Legacy Getters (Refactored to use the validated `env` object)
 * Keeping these signatures ensures backward compatibility with the rest of the app.
 */

export const getSupabaseUrl = (): string => {
  if (!env?.NEXT_PUBLIC_SUPABASE_URL)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not defined');
  return env.NEXT_PUBLIC_SUPABASE_URL;
};

export const getSupabaseAnonKey = (): string => {
  if (!env?.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined');
  return env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
};

export const getSupabaseServiceRoleKey = (): string => {
  if (typeof window !== 'undefined')
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY cannot be accessed on the client'
    );
  if (!env?.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined');
  return env.SUPABASE_SERVICE_ROLE_KEY;
};

export const getRecoveryCodePepper = (): string => {
  if (isBrowserRuntime()) {
    throw new Error('RECOVERY_CODE_PEPPER cannot be accessed on the client');
  }
  const pepper = trimSecret(
    process.env.RECOVERY_CODE_PEPPER ?? env?.RECOVERY_CODE_PEPPER
  );
  if (!pepper) {
    throw new Error('RECOVERY_CODE_PEPPER is not defined');
  }
  if (pepper.length < 32) {
    throw new Error('RECOVERY_CODE_PEPPER must be at least 32 characters');
  }
  return pepper;
};

const isBrowserRuntime = () =>
  // Server-route tests run in jsdom, so agentic server-only getters use this
  // helper to avoid treating Vitest's window shim as a real browser runtime.
  typeof window !== 'undefined' && process.env.NODE_ENV !== 'test';
const trimSecret = (value: string | undefined): string => value?.trim() ?? '';
const getRuntimeEnvValue = (
  rawValue: string | undefined,
  fallbackValue: string | undefined
): string | undefined => {
  const trimmedRaw = trimSecret(rawValue);
  if (trimmedRaw) return trimmedRaw;

  const trimmedFallback = trimSecret(fallbackValue);
  return trimmedFallback || undefined;
};
const getRuntimeEnvAliasValue = ({
  legacyFallback,
  legacyRaw,
  primaryFallback,
  primaryRaw,
}: {
  legacyFallback: string | undefined;
  legacyRaw: string | undefined;
  primaryFallback: string | undefined;
  primaryRaw: string | undefined;
}): string | undefined =>
  getRuntimeEnvValue(primaryRaw, primaryFallback) ??
  getRuntimeEnvValue(legacyRaw, legacyFallback);
const getRuntimeQuizIntegrityTierOverrides = (
  rawValue: string | undefined,
  fallbackValue: QuizIntegrityTierOverrides
): QuizIntegrityTierOverrides => {
  const trimmedRaw = trimSecret(rawValue);
  if (!trimmedRaw) return fallbackValue;

  const parsed = quizIntegrityTierOverridesSchema.safeParse(trimmedRaw);
  if (parsed.success) return parsed.data;

  throw new Error(
    'QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON must be a JSON object with basic, device, or strong values'
  );
};

export const getSupabaseJwtSecret = (): string => {
  if (isBrowserRuntime())
    throw new Error('SUPABASE_JWT_SECRET cannot be accessed on the client');
  const jwtSecret = trimSecret(
    process.env.SUPABASE_JWT_SECRET ?? env?.SUPABASE_JWT_SECRET
  );
  if (!jwtSecret) throw new Error('SUPABASE_JWT_SECRET is not defined');
  return jwtSecret;
};

export const getSupabaseLegacyAnonJwt = (): string | undefined => {
  if (isBrowserRuntime())
    throw new Error(
      'SUPABASE_LEGACY_ANON_JWT cannot be accessed on the client'
    );
  const legacyAnonJwt = trimSecret(
    process.env.SUPABASE_LEGACY_ANON_JWT ?? env?.SUPABASE_LEGACY_ANON_JWT
  );
  return legacyAnonJwt || undefined;
};

export const getSupabaseAgenticJwtPrivateJwk = (): string | undefined => {
  if (isBrowserRuntime())
    throw new Error(
      'SUPABASE_AGENTIC_JWT_PRIVATE_JWK cannot be accessed on the client'
    );
  const privateJwk = trimSecret(
    process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK ??
      env?.SUPABASE_AGENTIC_JWT_PRIVATE_JWK
  );
  return privateJwk || undefined;
};

// Optional Getters
export const getKorapaySecretKey = () => env?.KORAPAY_SECRET_KEY;
export const getKorapayPublicKey = () => env?.KORAPAY_PUBLIC_KEY;
export const getJuicywaySecretKey = () => env?.JUICYWAY_SECRET_KEY;
export const getJuicywayBaseUrl = () => env?.JUICYWAY_BASE_URL;
export const getKlumpSecretKey = () => {
  if (isBrowserRuntime()) return undefined;
  return getRuntimeEnvValue(
    process.env.KLUMP_SECRET_KEY,
    env?.KLUMP_SECRET_KEY
  );
};
export const getKlumpWebhookSecret = () => {
  if (isBrowserRuntime()) return undefined;
  return (
    getRuntimeEnvValue(
      process.env.KLUMP_WEBHOOK_SECRET,
      env?.KLUMP_WEBHOOK_SECRET
    ) ?? getKlumpSecretKey()
  );
};

// Agentic runtime secrets are read at call time so serverless env rotations and
// tests that stub process.env after module load use the current secret values.
export const getAgenticApiKey = () => {
  if (isBrowserRuntime()) return undefined;
  return getAgenticApiKeys()[0];
};
export const getAgenticApiKeys = () => {
  if (isBrowserRuntime()) return [];
  const currentApiKey = getRuntimeEnvAliasValue({
    legacyFallback: env?.OPENAI_AGENTIC_API_KEY,
    legacyRaw: process.env.OPENAI_AGENTIC_API_KEY,
    primaryFallback: env?.BACI_AGENTIC_ACCESS_TOKEN,
    primaryRaw: process.env.BACI_AGENTIC_ACCESS_TOKEN,
  });
  if (!currentApiKey) return [];

  const previousApiKey = getRuntimeEnvAliasValue({
    legacyFallback: env?.OPENAI_AGENTIC_API_KEY_PREVIOUS,
    legacyRaw: process.env.OPENAI_AGENTIC_API_KEY_PREVIOUS,
    primaryFallback: env?.BACI_AGENTIC_ACCESS_TOKEN_PREVIOUS,
    primaryRaw: process.env.BACI_AGENTIC_ACCESS_TOKEN_PREVIOUS,
  });

  return [currentApiKey, previousApiKey]
    .map((value) => trimSecret(value))
    .filter((value) => value.length > 0);
};
export const getAgenticConfirmationKeys = () => {
  if (isBrowserRuntime()) return [];
  return [
    getRuntimeEnvAliasValue({
      legacyFallback: env?.OPENAI_AGENTIC_CONFIRMATION_KEY,
      legacyRaw: process.env.OPENAI_AGENTIC_CONFIRMATION_KEY,
      primaryFallback: env?.BACI_AGENTIC_CONFIRMATION_KEY,
      primaryRaw: process.env.BACI_AGENTIC_CONFIRMATION_KEY,
    }),
    getRuntimeEnvAliasValue({
      legacyFallback: env?.OPENAI_AGENTIC_CONFIRMATION_KEY_PREVIOUS,
      legacyRaw: process.env.OPENAI_AGENTIC_CONFIRMATION_KEY_PREVIOUS,
      primaryFallback: env?.BACI_AGENTIC_CONFIRMATION_KEY_PREVIOUS,
      primaryRaw: process.env.BACI_AGENTIC_CONFIRMATION_KEY_PREVIOUS,
    }),
  ]
    .map((value) => trimSecret(value))
    .filter((value) => value.length > 0);
};
export const getAgenticMerchantSlug = () => {
  if (isBrowserRuntime()) return undefined;
  return getRuntimeEnvAliasValue({
    legacyFallback: env?.OPENAI_AGENTIC_MERCHANT_SLUG,
    legacyRaw: process.env.OPENAI_AGENTIC_MERCHANT_SLUG,
    primaryFallback: env?.BACI_AGENTIC_MERCHANT_SLUG,
    primaryRaw: process.env.BACI_AGENTIC_MERCHANT_SLUG,
  });
};
export const getAgenticSigningKeys = () => {
  if (isBrowserRuntime()) return [];
  return [
    getRuntimeEnvAliasValue({
      legacyFallback: env?.OPENAI_AGENTIC_SIGNING_KEY,
      legacyRaw: process.env.OPENAI_AGENTIC_SIGNING_KEY,
      primaryFallback: env?.BACI_AGENTIC_SIGNING_KEY,
      primaryRaw: process.env.BACI_AGENTIC_SIGNING_KEY,
    }),
    getRuntimeEnvAliasValue({
      legacyFallback: env?.OPENAI_AGENTIC_SIGNING_KEY_PREVIOUS,
      legacyRaw: process.env.OPENAI_AGENTIC_SIGNING_KEY_PREVIOUS,
      primaryFallback: env?.BACI_AGENTIC_SIGNING_KEY_PREVIOUS,
      primaryRaw: process.env.BACI_AGENTIC_SIGNING_KEY_PREVIOUS,
    }),
  ]
    .map((value) => trimSecret(value))
    .filter((value) => value.length > 0);
};
export const getPaystackSecretKey = () => {
  if (isBrowserRuntime()) return undefined;
  const secret = trimSecret(
    process.env.PAYSTACK_SECRET_KEY ?? env?.PAYSTACK_SECRET_KEY
  );
  return secret || undefined;
};
export const getBaciCdnOriginFetchSecret = () => {
  if (isBrowserRuntime()) return undefined;
  return getRuntimeEnvValue(
    process.env.BACI_CDN_ORIGIN_FETCH_SECRET,
    env?.BACI_CDN_ORIGIN_FETCH_SECRET
  );
};
export type GooglePayAgenticConfig = {
  gateway: string;
  gatewayMerchantId: string;
  merchantId: string;
};
export const getGooglePayAgenticConfig = () => {
  if (isBrowserRuntime()) return null;
  const enabled = ['1', 'on', 'true', 'yes'].includes(
    trimSecret(
      process.env.BACI_GOOGLE_PAY_ENABLED ?? env?.BACI_GOOGLE_PAY_ENABLED
    ).toLowerCase()
  );
  const gateway = trimSecret(
    process.env.BACI_GOOGLE_PAY_GATEWAY ?? env?.BACI_GOOGLE_PAY_GATEWAY
  ).toLowerCase();
  const gatewayMerchantId = trimSecret(
    process.env.BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID ??
      env?.BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID
  );
  const merchantId = trimSecret(
    process.env.BACI_GOOGLE_PAY_MERCHANT_ID ?? env?.BACI_GOOGLE_PAY_MERCHANT_ID
  );

  if (!enabled || !gateway || !gatewayMerchantId || !merchantId) {
    return null;
  }

  return { gateway, gatewayMerchantId, merchantId };
};
export const getSickwApiKey = () => {
  if (isBrowserRuntime()) return undefined;
  const secret = trimSecret(process.env.SICKW_API_KEY ?? env?.SICKW_API_KEY);
  return secret || undefined;
};
export const getImeiHashSalt = () => {
  if (isBrowserRuntime()) return undefined;
  const salt = trimSecret(process.env.IMEI_HASH_SALT ?? env?.IMEI_HASH_SALT);
  return salt || undefined;
};
export const getImeiDisabledTierKeys = () => {
  if (isBrowserRuntime()) return [];
  const raw = trimSecret(
    process.env.IMEI_DISABLED_TIERS ?? env?.IMEI_DISABLED_TIERS
  );
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
};
export const getImeiIdentifierEncryptionKey = () => {
  if (isBrowserRuntime()) return undefined;
  const key = trimSecret(
    process.env.IMEI_IDENTIFIER_ENCRYPTION_KEY ??
      env?.IMEI_IDENTIFIER_ENCRYPTION_KEY
  );
  return key || undefined;
};

export const getJumiaAuthorizationEncryptionKey = () => {
  if (isBrowserRuntime()) return undefined;
  const key = trimSecret(
    process.env.JUMIA_AUTHORIZATION_ENCRYPTION_KEY ??
      env?.JUMIA_AUTHORIZATION_ENCRYPTION_KEY
  );
  return key || undefined;
};

function normalizePetrockBaseUrl(value: string) {
  const baseUrl = value.replace(/\/+$/, '');
  try {
    const parsed = new URL(baseUrl);
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return `${parsed.origin}/api/reseller/v1`;
    }
  } catch {
    return baseUrl;
  }
  return baseUrl;
}

export const getPetrockConfig = () => {
  if (isBrowserRuntime()) return null;
  const token = trimSecret(
    process.env.PETROCK_API_TOKEN ?? env?.PETROCK_API_TOKEN
  );
  if (!token) return null;

  const baseUrl = normalizePetrockBaseUrl(
    trimSecret(process.env.PETROCK_API_BASE_URL ?? env?.PETROCK_API_BASE_URL) ||
      'https://api.petrock.biz/api/reseller/v1'
  );
  return {
    baseUrl,
    token,
  };
};
export const getPetrockEnabledTierKeys = () => {
  if (isBrowserRuntime()) return [];
  const raw = trimSecret(
    process.env.PETROCK_ENABLED_TIERS ?? env?.PETROCK_ENABLED_TIERS
  );
  if (!raw) return [];

  return [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
};
export const isPetrockEnabled = () => {
  if (isBrowserRuntime()) return false;
  const runtimeValue = normalizeEnvBoolean(
    trimSecret(process.env.PETROCK_ENABLED)
  );
  return runtimeValue ?? env?.PETROCK_ENABLED ?? false;
};
export const isPetrockRemediationEnabled = () => {
  if (isBrowserRuntime()) return false;
  const runtimeValue = normalizeEnvBoolean(
    trimSecret(process.env.PETROCK_REMEDIATION_ENABLED)
  );
  return runtimeValue ?? env?.PETROCK_REMEDIATION_ENABLED ?? false;
};
export const isUsdtWalletEnabled = () => {
  if (isBrowserRuntime()) return false;
  const runtimeValue = normalizeEnvBoolean(
    trimSecret(process.env.USDT_WALLET_ENABLED)
  );
  return runtimeValue ?? env?.USDT_WALLET_ENABLED ?? false;
};
export const isWalletCreditPushEnabled = () => {
  if (isBrowserRuntime()) return false;
  const runtimeValue = normalizeEnvBoolean(
    trimSecret(process.env.WALLET_CREDIT_PUSH_ENABLED)
  );
  return runtimeValue ?? env?.WALLET_CREDIT_PUSH_ENABLED ?? false;
};
export const getImeiFxNgnUsd = () => {
  if (isBrowserRuntime()) return undefined;
  const runtimeValue = Number(process.env.IMEI_FX_NGN_USD);
  if (Number.isFinite(runtimeValue) && runtimeValue > 0) return runtimeValue;
  return env?.IMEI_FX_NGN_USD;
};
export const getKudaBillDebug = () => {
  if (isBrowserRuntime()) return undefined;
  const debug = trimSecret(process.env.KUDA_BILL_DEBUG ?? env?.KUDA_BILL_DEBUG);
  return debug || undefined;
};
export const getQuizPhaseEnv = () => {
  if (isBrowserRuntime())
    throw new Error('QUIZ_PHASE cannot be accessed on the client');
  const phase =
    getRuntimeEnvValue(process.env.QUIZ_PHASE, env?.QUIZ_PHASE) || '1a';
  if (phase === '1a' || phase === 'production') return phase;
  throw new Error('QUIZ_PHASE must be 1a or production');
};
export const getQuizProductionApprovedEnv = () => {
  if (isBrowserRuntime())
    throw new Error(
      'QUIZ_PRODUCTION_APPROVED cannot be accessed on the client'
    );
  const configured = trimSecret(process.env.QUIZ_PRODUCTION_APPROVED);
  if (!configured) return env?.QUIZ_PRODUCTION_APPROVED ?? false;
  const normalized = normalizeEnvBoolean(configured);
  if (normalized !== undefined) return normalized;
  throw new Error(
    'QUIZ_PRODUCTION_APPROVED must be one of true/false/1/0/yes/no'
  );
};
export const getQuizRpcServerSecret = () => {
  if (isBrowserRuntime())
    throw new Error('QUIZ_RPC_SERVER_SECRET cannot be accessed on the client');
  const secret = getRuntimeEnvValue(
    process.env.QUIZ_RPC_SERVER_SECRET,
    env?.QUIZ_RPC_SERVER_SECRET
  );
  return secret || undefined;
};
export const getQuizDeviceHashPepper = () => {
  if (isBrowserRuntime())
    throw new Error('QUIZ_DEVICE_HASH_PEPPER cannot be accessed on the client');
  const pepper = getRuntimeEnvValue(
    process.env.QUIZ_DEVICE_HASH_PEPPER,
    env?.QUIZ_DEVICE_HASH_PEPPER
  );
  return pepper || undefined;
};
export const getQuizIntegrityTierOverridesJson = () => {
  if (isBrowserRuntime())
    throw new Error(
      'QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON cannot be accessed on the client'
    );
  return getRuntimeQuizIntegrityTierOverrides(
    process.env.QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON,
    env?.QUIZ_APP_INTEGRITY_TIER_OVERRIDES_JSON
  );
};
export const getZeptoMailToken = () =>
  env?.ZEPTOMAIL_TOKEN?.trim() || undefined;
export const getZeptoMailFromDomain = () =>
  env?.ZEPTOMAIL_FROM_DOMAIN?.trim() || 'usebaci.com';
export const getZohoClientId = () =>
  getRuntimeEnvValue(process.env.ZOHO_CLIENT_ID, env?.ZOHO_CLIENT_ID);
export const getZohoClientSecret = () =>
  getRuntimeEnvValue(process.env.ZOHO_CLIENT_SECRET, env?.ZOHO_CLIENT_SECRET);
export const getZohoRefreshToken = () =>
  getRuntimeEnvValue(process.env.ZOHO_REFRESH_TOKEN, env?.ZOHO_REFRESH_TOKEN);
export const getZeptoMailAgentKey = () =>
  getRuntimeEnvValue(
    process.env.ZEPTOMAIL_MAILAGENT_KEY,
    env?.ZEPTOMAIL_MAILAGENT_KEY
  );

const normalizeRuntimeBoolean = (value: string | undefined): boolean => {
  if (!value) return false;
  return normalizeEnvBoolean(value) === true;
};

const normalizeRuntimePositiveInteger = (
  value: string | undefined,
  fallback: number
): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getRuntimeUrl = (
  rawValue: string | undefined,
  fallbackValue: string | undefined,
  fallbackDefault: string
): string => getRuntimeEnvValue(rawValue, fallbackValue) ?? fallbackDefault;

const getZohoCampaignsRedirectUri = () =>
  getRuntimeEnvValue(
    process.env.ZOHO_CAMPAIGNS_REDIRECT_URI,
    env?.ZOHO_CAMPAIGNS_REDIRECT_URI
  ) ?? `${getAppUrl().replace(/\/$/, '')}/api/integrations/zoho/callback`;

export type ZohoCampaignsOAuthConfig = {
  accountsServerUrl: string;
  clientId?: string;
  clientSecret?: string;
  oauthState?: string;
  redirectUri: string;
};

export type ZohoCampaignsRuntimeConfig = ZohoCampaignsOAuthConfig & {
  apiRootUrl: string;
  autoSend: boolean;
  enabled: boolean;
  fromEmail?: string;
  fromName: string;
  listKey?: string;
  publicBaseUrl: string;
  contentSecret?: string;
  refreshToken?: string;
  requestTimeoutMs: number;
  topicId?: string;
};

export const getZohoCampaignsOAuthConfig = (): ZohoCampaignsOAuthConfig => {
  if (isBrowserRuntime())
    throw new Error(
      'Zoho Campaigns OAuth config cannot be accessed on the client'
    );

  return {
    accountsServerUrl: getRuntimeUrl(
      process.env.ZOHO_CAMPAIGNS_ACCOUNTS_SERVER_URL,
      env?.ZOHO_CAMPAIGNS_ACCOUNTS_SERVER_URL,
      'https://accounts.zoho.com'
    ),
    clientId: getRuntimeEnvValue(
      process.env.ZOHO_CAMPAIGNS_CLIENT_ID,
      env?.ZOHO_CAMPAIGNS_CLIENT_ID
    ),
    clientSecret: getRuntimeEnvValue(
      process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET,
      env?.ZOHO_CAMPAIGNS_CLIENT_SECRET
    ),
    oauthState: getRuntimeEnvValue(
      process.env.ZOHO_CAMPAIGNS_OAUTH_STATE,
      env?.ZOHO_CAMPAIGNS_OAUTH_STATE
    ),
    redirectUri: getZohoCampaignsRedirectUri(),
  };
};

export const getZohoCampaignsRuntimeConfig = (): ZohoCampaignsRuntimeConfig => {
  if (isBrowserRuntime())
    throw new Error('Zoho Campaigns config cannot be accessed on the client');

  const oauthConfig = getZohoCampaignsOAuthConfig();

  return {
    ...oauthConfig,
    apiRootUrl: getRuntimeUrl(
      process.env.ZOHO_CAMPAIGNS_API_ROOT_URL,
      env?.ZOHO_CAMPAIGNS_API_ROOT_URL,
      'https://campaigns.zoho.com/api/v1.1'
    ),
    autoSend: normalizeRuntimeBoolean(
      getRuntimeEnvValue(
        process.env.ZOHO_CAMPAIGNS_AUTO_SEND,
        env?.ZOHO_CAMPAIGNS_AUTO_SEND
      )
    ),
    enabled: normalizeRuntimeBoolean(
      getRuntimeEnvValue(
        process.env.ZOHO_CAMPAIGNS_ENABLED,
        env?.ZOHO_CAMPAIGNS_ENABLED
      )
    ),
    fromEmail: undefined,
    fromName:
      getRuntimeEnvValue(
        process.env.ZOHO_CAMPAIGNS_FROM_NAME,
        env?.ZOHO_CAMPAIGNS_FROM_NAME
      ) ?? 'Store Updates',
    listKey: undefined,
    publicBaseUrl: getRuntimeUrl(
      process.env.ZOHO_CAMPAIGNS_PUBLIC_BASE_URL,
      env?.ZOHO_CAMPAIGNS_PUBLIC_BASE_URL,
      getAppUrl()
    ),
    contentSecret: getRuntimeEnvValue(
      process.env.ZOHO_CAMPAIGNS_CONTENT_SECRET,
      env?.ZOHO_CAMPAIGNS_CONTENT_SECRET
    ),
    refreshToken: undefined,
    requestTimeoutMs: normalizeRuntimePositiveInteger(
      getRuntimeEnvValue(
        process.env.ZOHO_CAMPAIGNS_REQUEST_TIMEOUT_MS,
        env?.ZOHO_CAMPAIGNS_REQUEST_TIMEOUT_MS
      ),
      15_000
    ),
    topicId: getRuntimeEnvValue(
      process.env.ZOHO_CAMPAIGNS_TOPIC_ID,
      env?.ZOHO_CAMPAIGNS_TOPIC_ID
    ),
  };
};

export const getGeminiApiKey = () =>
  env?.GOOGLE_GENAI_API_KEY || env?.GEMINI_API_KEY;
export const getGooglePlacesApiKey = () =>
  process.env.GOOGLE_PLACES_API_KEY?.trim() ||
  env?.GOOGLE_PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY?.trim() ||
  env?.GOOGLE_MAPS_API_KEY;
export const getAiChatModel = () => {
  if (typeof window !== 'undefined')
    throw new Error('AI_CHAT_MODEL cannot be accessed on the client');
  return validateSanitizedModel(env.AI_CHAT_MODEL, 'AI_CHAT_MODEL');
};
export const getAiChatProvider = (): AiChatProvider => {
  if (typeof window !== 'undefined')
    throw new Error('AI_CHAT_PROVIDER cannot be accessed on the client');

  const runtimeProvider = process.env.AI_CHAT_PROVIDER;
  if (runtimeProvider !== undefined) {
    const parsedProvider = aiChatProviderSchema.safeParse(runtimeProvider);
    if (!parsedProvider.success) {
      throw new Error(
        'AI_CHAT_PROVIDER must be one of auto, gemini, llm, ollama'
      );
    }

    return parsedProvider.data;
  }

  return env.AI_CHAT_PROVIDER;
};
export const getCreditDirectPublicKey = () => env?.CREDIT_DIRECT_PUBLIC_KEY;
export const getCreditDirectPrivateKey = () => env?.CREDIT_DIRECT_PRIVATE_KEY;

// Blog - The Fix for "Invalid Token"
// Now guaranteed to have a value (defaulting to dev-preview-secret if missing)
export const getBlogPreviewSecret = (): string => {
  return env?.BLOG_PREVIEW_SECRET || 'dev-preview-secret';
};

export const getRootDomain = () => env?.NEXT_PUBLIC_ROOT_DOMAIN;
export const getAppUrl = () =>
  env?.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
// OAuth routes need to know whether NEXT_PUBLIC_APP_URL was explicitly configured.
// Reading process.env directly avoids the Zod fallback so missing config does not
// silently degrade to localhost in callback URLs.
export const getConfiguredAppUrl = (): string | null => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!appUrl) {
    return null;
  }

  try {
    // OAuth callbacks must use a publicly reachable origin, not a local dev URL.
    const parsedUrl = new URL(appUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.startsWith('127.') ||
      hostname.endsWith('.localhost')
    ) {
      return null;
    }

    return appUrl;
  } catch {
    return null;
  }
};

export const getMyCoverWebhookSecret = (): string => {
  if (typeof window !== 'undefined')
    throw new Error('MYCOVER_WEBHOOK_SECRET cannot be accessed on the client');
  const webhookSecret =
    env?.MYCOVER_WEBHOOK_SECRET?.trim() ||
    process.env.MYCOVER_SECRET_KEY?.trim();
  if (!webhookSecret)
    throw new Error(
      'MYCOVER_WEBHOOK_SECRET or MYCOVER_SECRET_KEY is not defined'
    );
  return webhookSecret;
};

export const getMyCoverSecretKey = (): string | undefined => {
  if (typeof window !== 'undefined')
    throw new Error('MYCOVER_SECRET_KEY cannot be accessed on the client');
  return process.env.MYCOVER_SECRET_KEY?.trim() || undefined;
};

export const getCronSecret = () => env?.CRON_SECRET;

/**
 * App Store Connect API credentials for the ios-live-build-sync cron. Returns
 * null when any piece is missing so the cron can skip cleanly rather than throw.
 */
export const getAppStoreConnectCredentials = () => {
  const keyId = env?.ASC_API_KEY_ID;
  const issuerId = env?.ASC_API_ISSUER_ID;
  const privateKey = env?.ASC_API_PRIVATE_KEY;
  if (!keyId || !issuerId || !privateKey) return null;
  return { keyId, issuerId, privateKey };
};

export const getAppStoreConnectBundleId = (
  app: 'storefront' | 'admin' = 'storefront'
) =>
  app === 'admin'
    ? (env?.APP_STORE_CONNECT_ADMIN_BUNDLE_ID ?? 'com.ogabassey.baci')
    : (env?.APP_STORE_CONNECT_BUNDLE_ID ?? 'com.ogabassey.app');

export const getGooglePlayServiceAccountJson = () =>
  env?.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

export const getGooglePlayPackageName = (
  app: 'storefront' | 'admin' = 'storefront'
) =>
  app === 'admin'
    ? (env?.GOOGLE_PLAY_ADMIN_PACKAGE_NAME ?? 'com.ogabassey.baci')
    : (env?.GOOGLE_PLAY_PACKAGE_NAME ?? 'com.ogabassey.store');

export const getAppStoreConnectWebhookSecret = (
  app: 'storefront' | 'admin' = 'storefront'
) =>
  app === 'admin'
    ? env?.APP_STORE_CONNECT_ADMIN_WEBHOOK_SECRET
    : env?.APP_STORE_CONNECT_WEBHOOK_SECRET;

export const getInternalApiSecret = () => {
  if (isBrowserRuntime())
    throw new Error('INTERNAL_API_SECRET cannot be accessed on the client');
  return getRuntimeEnvValue(
    process.env.INTERNAL_API_SECRET,
    env?.INTERNAL_API_SECRET
  );
};

export const getCloudflareApiToken = () => {
  if (isBrowserRuntime())
    throw new Error('CLOUDFLARE_API_TOKEN cannot be accessed on the client');
  return getRuntimeEnvValue(
    process.env.CLOUDFLARE_API_TOKEN,
    env?.CLOUDFLARE_API_TOKEN
  );
};

export const getCloudflareZoneId = () => {
  if (isBrowserRuntime())
    throw new Error('CLOUDFLARE_ZONE_ID cannot be accessed on the client');
  return getRuntimeEnvValue(
    process.env.CLOUDFLARE_ZONE_ID,
    env?.CLOUDFLARE_ZONE_ID
  );
};

export const getImportJobWorkerBatchSize = () =>
  env?.IMPORT_JOB_WORKER_BATCH_SIZE || 3;

export const getImportJobWorkerTriggerUrl = () => {
  if (isBrowserRuntime())
    throw new Error('IMPORT_JOB_TRIGGER_URL cannot be accessed on the client');
  return env?.IMPORT_JOB_TRIGGER_URL;
};

export const getImportJobWorkerTriggerSecret = () => {
  if (isBrowserRuntime())
    throw new Error(
      'IMPORT_JOB_TRIGGER_SECRET cannot be accessed on the client'
    );
  return env?.IMPORT_JOB_TRIGGER_SECRET;
};

export const getImportJobWorkerTriggerTimeoutMs = () => {
  if (isBrowserRuntime())
    throw new Error(
      'IMPORT_JOB_TRIGGER_TIMEOUT_MS cannot be accessed on the client'
    );
  return env?.IMPORT_JOB_TRIGGER_TIMEOUT_MS || 5000;
};

export const getTerminalIdempotencyRecordWindowMs = () => {
  if (isBrowserRuntime())
    throw new Error(
      'TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS cannot be accessed on the client'
    );
  return (
    env?.TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS ??
    DEFAULT_TERMINAL_IDEMPOTENCY_RECORD_WINDOW_MS
  );
};

export const isImportJobDirectUploadEnabled = () => {
  if (typeof window !== 'undefined') {
    return false;
  }

  return env?.IMPORT_JOB_DIRECT_UPLOAD_ENABLED ?? true;
};

export const isProduction = () => env?.NODE_ENV === 'production';

// Jumia
export const getJumiaEnvironment = () => env?.JUMIA_ENVIRONMENT;
export const getJumiaClientId = () => env?.JUMIA_CLIENT_ID;
export const getJumiaClientSecret = () => {
  if (typeof window !== 'undefined')
    throw new Error('JUMIA_CLIENT_SECRET cannot be accessed on the client');
  return env?.JUMIA_CLIENT_SECRET;
};

// Push Notifications
export const getExpoAccessToken = () => {
  if (typeof window !== 'undefined')
    throw new Error('EXPO_ACCESS_TOKEN cannot be accessed on the client');
  return env?.EXPO_ACCESS_TOKEN;
};

// Monnify / Ollama (Identity verification)
export const getMonnifyApiKey = () => {
  if (typeof window !== 'undefined')
    throw new Error('MONNIFY_API_KEY cannot be accessed on the client');
  return env?.MONNIFY_API_KEY;
};
export const getMonnifySecretKey = () => {
  if (typeof window !== 'undefined')
    throw new Error('MONNIFY_SECRET_KEY cannot be accessed on the client');
  return env?.MONNIFY_SECRET_KEY;
};
export const getMonnifyBaseUrl = () =>
  env?.MONNIFY_BASE_URL ?? 'https://api.monnify.com';
export const getCacApiUrl = () => env?.CAC_API_URL ?? DEFAULT_CAC_API_URL;
export const getCacTinApiBaseUrl = () =>
  env?.CAC_TIN_API_BASE_URL ?? DEFAULT_CAC_TIN_API_BASE_URL;
export const getOllamaBaseUrl = () => {
  if (typeof window !== 'undefined')
    throw new Error('OLLAMA_BASE_URL cannot be accessed on the client');
  return env?.OLLAMA_BASE_URL;
};
export const getOllamaCacModel = () => {
  if (typeof window !== 'undefined')
    throw new Error('OLLAMA_CAC_MODEL cannot be accessed on the client');
  return validateSanitizedModel(env.OLLAMA_CAC_MODEL, 'OLLAMA_CAC_MODEL');
};
export const getOllamaBasicAuth = () => {
  if (typeof window !== 'undefined')
    throw new Error('OLLAMA_BASIC_AUTH cannot be accessed on the client');
  return env?.OLLAMA_BASIC_AUTH;
};
export const getOllamaStorefrontBaseUrl = () => {
  if (isBrowserRuntime())
    throw new Error(
      'OLLAMA_STOREFRONT_BASE_URL cannot be accessed on the client'
    );
  return env?.OLLAMA_STOREFRONT_BASE_URL;
};
export const getOllamaStorefrontBasicAuth = () => {
  if (isBrowserRuntime())
    throw new Error(
      'OLLAMA_STOREFRONT_BASIC_AUTH cannot be accessed on the client'
    );
  return env?.OLLAMA_STOREFRONT_BASIC_AUTH;
};
export const getOllamaStorefrontModel = () => {
  if (isBrowserRuntime())
    throw new Error('OLLAMA_STOREFRONT_MODEL cannot be accessed on the client');
  return validateSanitizedModel(
    env.OLLAMA_STOREFRONT_MODEL,
    'OLLAMA_STOREFRONT_MODEL'
  );
};
export const getOllamaStorefrontTimeoutMs = () => {
  if (isBrowserRuntime())
    throw new Error(
      'OLLAMA_STOREFRONT_TIMEOUT_MS cannot be accessed on the client'
    );
  return env.OLLAMA_STOREFRONT_TIMEOUT_MS;
};
export const isAiStorefrontGenerationEnabled = () => {
  if (isBrowserRuntime())
    throw new Error(
      'AI_STOREFRONT_GENERATION_ENABLED cannot be accessed on the client'
    );
  return env.AI_STOREFRONT_GENERATION_ENABLED;
};
export const getAiStorefrontWorkerTriggerUrl = () => {
  if (isBrowserRuntime())
    throw new Error(
      'AI_STOREFRONT_TRIGGER_URL cannot be accessed on the client'
    );
  return env?.AI_STOREFRONT_TRIGGER_URL;
};
export const getAiStorefrontWorkerTriggerSecret = () => {
  if (isBrowserRuntime())
    throw new Error(
      'AI_STOREFRONT_TRIGGER_SECRET cannot be accessed on the client'
    );
  return env?.AI_STOREFRONT_TRIGGER_SECRET;
};
export const getAiStorefrontWorkerTriggerTimeoutMs = () => {
  if (isBrowserRuntime())
    throw new Error(
      'AI_STOREFRONT_TRIGGER_TIMEOUT_MS cannot be accessed on the client'
    );
  return env.AI_STOREFRONT_TRIGGER_TIMEOUT_MS;
};
export const getLlmServerUrl = () => {
  if (isBrowserRuntime())
    throw new Error('LLM_SERVER_URL cannot be accessed on the client');
  return env?.LLM_SERVER_URL;
};
export const getLlmServerBearer = () => {
  if (isBrowserRuntime())
    throw new Error('LLM_SERVER_BEARER cannot be accessed on the client');
  return env?.LLM_SERVER_BEARER;
};
export const getLlmChatModel = () => {
  if (isBrowserRuntime())
    throw new Error('LLM_CHAT_MODEL cannot be accessed on the client');
  return validateSanitizedModel(env.LLM_CHAT_MODEL, 'LLM_CHAT_MODEL');
};

// Deprecated: No longer needed as we validate on import.
export const validateEnvironment = () => ({ valid: true, warnings: [] });
