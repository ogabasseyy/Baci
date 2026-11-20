import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Configure Google AI provider with API key from environment
const google = createGoogleGenerativeAI({
  apiKey:
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

/**
 * Gemini Model Exports (Vercel AI SDK)
 *
 * Model Selection Guide:
 * - activeTextModel: Standard Gemini 2.5 Flash text model
 * - fallbackTextModel: Gemini 2.5 Flash-Lite, used when the primary model's
 *   quota pool is exhausted (free-tier daily quotas are per model)
 * - geminiFlash / geminiPro: Aliases to the primary text model
 * - gemini25FlashImage: Multimodal model for text, image understanding, AND image generation
 *   Use with providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }
 */

// Primary text model - Gemini 2.5 Flash.
// Do NOT move this back to the 2.0 family: Google zeroed gemini-2.0-flash's
// free-tier quota (429 "generate_content_free_tier_input_token_count,
// limit: 0" — probed against the production key on 2026-07-06), which made
// every text surface (AI copilot, chat, product descriptions) fail 100% of
// the time on a free-tier key. The 2.5 family carries the free-tier quota.
export const ACTIVE_TEXT_MODEL_NAME = 'gemini-2.5-flash';
const primaryTextModel = google(ACTIVE_TEXT_MODEL_NAME);

// Quota fallback: free-tier requests-per-day pools are PER MODEL, so when the
// primary model's daily pool runs dry a flash-lite retry keeps AI editing
// alive instead of dead-ending merchants (a Play "Broken Functionality"
// repeat offender). Flash-Lite also has the largest free-tier RPD of the family.
export const FALLBACK_TEXT_MODEL_NAME = 'gemini-2.5-flash-lite';
export const fallbackTextModel = google(FALLBACK_TEXT_MODEL_NAME);

// The AI Copilot multi-provider chain (Cerebras Gemma → Groq → Gemini →
// OpenRouter) lives in ./copilot-provider-chain to keep this shared provider
// module focused on model definitions and under the 300-line file limit.

// UNIFIED MODEL EXPORTS - USE THESE FOR NEW FEATURES
// --------------------------------------------------------------------------
export const activeTextModel = primaryTextModel; // The single standard text model for the platform
export const activeImageModel = google('gemini-2.5-flash-image'); // Fast, cost-effective image generation
// --------------------------------------------------------------------------

// Legacy / Specific Aliases (Prefer activeTextModel where possible)
export const geminiFlash = primaryTextModel; // Alias for backwards compatibility
export const geminiPro = primaryTextModel; // Alias for pro-level tasks

// Legacy models (kept for fallback)
export const gemini25Flash = primaryTextModel; // Alias — 2.5 Flash is now the primary model

// Image generation models (December 2025)
// Image generation models (December 2025)
// alias for compatibility
const gemini25FlashImage = activeImageModel;

export { gemini25FlashImage };
export const gemini3ProImage = google('gemini-3-pro-image-preview'); // High quality image gen (Nano Banana Pro)

// Imagen 3 model for dedicated image generation (legacy)
// Note: Use 002 version for Google AI API (001 is only available in Vertex AI)
export const imagen3 = google.image('imagen-3.0-generate-002');

/**
 * Rate Limiting Configuration
 * Prevents API abuse and manages costs
 */
// Limits are best effort: the counter is per server instance (see below).
export const AI_RATE_LIMITS = {
  // Per-user limits (requests per minute)
  builder: { requests: 10, windowMs: 60 * 1000 },
  productDescription: { requests: 20, windowMs: 60 * 1000 },
  autofill: { requests: 30, windowMs: 60 * 1000 },
  insights: { requests: 5, windowMs: 60 * 1000 },
  imageGeneration: { requests: 5, windowMs: 60 * 1000 },
  santa: { requests: 1000, windowMs: 60 * 1000 },
  faqGeneration: { requests: 5, windowMs: 60 * 1000 },
  // Customer-chat assistant: per conversation, and per store as a ceiling.
  chatAutoReplyConversation: { requests: 6, windowMs: 60 * 1000 },
  chatAutoReplyMerchant: { requests: 60, windowMs: 60 * 1000 },
};

/**
 * In-memory rate limiter for AI requests
 * Uses a sliding window approach
 *
 * LIMITATION: This store lives in process memory. In serverless environments
 * (Vercel Functions), each cold start creates a fresh Map, so rate limits
 * reset when the instance is recycled. For stricter enforcement, migrate
 * to Vercel KV or Upstash Redis with sliding-window counters.
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  identifier: string,
  limitConfig: { requests: number; windowMs: number }
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  // Clean up expired entries periodically
  if (rateLimitStore.size > 10000) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }

  if (!record || record.resetTime < now) {
    // New window
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + limitConfig.windowMs,
    });
    return {
      allowed: true,
      remaining: limitConfig.requests - 1,
      resetIn: limitConfig.windowMs,
    };
  }

  if (record.count >= limitConfig.requests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: record.resetTime - now,
    };
  }

  record.count++;
  return {
    allowed: true,
    remaining: limitConfig.requests - record.count,
    resetIn: record.resetTime - now,
  };
}

// Retry logic lives in ./with-retry (extracted to keep this file <300 lines);
// re-exported here so existing '@/ai/provider' call sites keep working.
export {
  AI_RETRY_CONFIG,
  type WithRetryOptions,
  withRetry,
} from './with-retry';

/**
 * Result of sanitizing prompt input
 */
export interface SanitizeResult {
  value: string;
  metadata: {
    wasTruncated: boolean;
    originalLength: number;
    finalLength: number;
    limit: number;
  };
}

/**
 * Sanitize user input for AI prompts to prevent prompt injection
 * @returns Object with sanitized value and metadata about truncation
 */
export function sanitizePromptInput(
  input: string,
  maxLength: number = 500
): SanitizeResult {
  if (!input) {
    return {
      value: '',
      metadata: {
        wasTruncated: false,
        originalLength: 0,
        finalLength: 0,
        limit: maxLength,
      },
    };
  }

  const originalLength = input.length;

  let sanitized = input
    // Remove common prompt injection patterns
    .replace(/ignore (previous|all|above|prior) (instructions?|prompts?)/gi, '')
    .replace(/disregard (previous|all|above|prior)/gi, '')
    .replace(/forget (everything|all|previous)/gi, '')
    .replace(/new instructions?:/gi, '')
    .replace(/system:/gi, '')
    .replace(/assistant:/gi, '')
    .replace(/user:/gi, '')
    // Remove markdown/formatting that could affect prompt
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Limit length
  const wasTruncated = sanitized.length > maxLength;
  if (wasTruncated) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return {
    value: sanitized,
    metadata: {
      wasTruncated,
      originalLength,
      finalLength: sanitized.length,
      limit: maxLength,
    },
  };
}
