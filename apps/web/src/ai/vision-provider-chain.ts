import {
  getOnboardingTextProviderChain,
  getTextProviderChain,
  type TextProvider,
} from './text-provider-chain';

/**
 * Provider chain for image-INPUT tasks (OCR, logo color extraction, photo
 * price-list parsing). Same order as the text chain, minus providers that
 * cannot accept image parts (Groq gpt-oss-120b) and the opportunistic
 * OpenRouter pool (429-contended; never worth a vision retry).
 *
 * Callers must send images as raw bytes (Uint8Array/Buffer), NOT remote URLs:
 * Cerebras only accepts base64 data URIs, and the AI SDK passes URL parts
 * through verbatim to OpenAI-compatible providers instead of downloading
 * them. Image generation is NOT covered here — no chain provider besides
 * Gemini can produce images, so image-output features stay on
 * `activeImageModel` from ./provider.
 */
export function getVisionProviderChain(): TextProvider[] {
  return getTextProviderChain().filter(
    (provider) => provider.vision && !provider.opportunistic
  );
}

/**
 * Onboarding-scoped vision chain for authenticated, paid-OpenAI-authorized
 * callers: places OpenAI first when `OPENAI_API_KEY` is configured and falls
 * back to the platform vision chain.
 */
export function getOnboardingVisionProviderChain(): TextProvider[] {
  return getOnboardingTextProviderChain().filter(
    (provider) => provider.vision && !provider.opportunistic
  );
}
