import OpenAI from 'openai';
import { logger } from '@/lib/logger';

const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1.5';
const OPENAI_LOGO_TIMEOUT_MS = 20_000;

export function getOpenAiImageModelName(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
}

/**
 * Generates a single square PNG logo as a data URI via OpenAI Images API when
 * `OPENAI_API_KEY` is configured. Returns `null` when unconfigured or on error
 * so callers fall back cleanly to Gemini / SVG generation.
 */
export async function generateOpenAiLogo(
  prompt: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const model = getOpenAiImageModelName();
  try {
    const client = new OpenAI({
      apiKey,
      timeout: OPENAI_LOGO_TIMEOUT_MS,
      maxRetries: 0,
    });
    const response = await client.images.generate({
      model,
      prompt,
      size: '1024x1024',
      n: 1,
    });

    const image = response.data?.[0];
    if (image?.b64_json) {
      return `data:image/png;base64,${image.b64_json}`;
    }

    logger.warn({
      message: 'OpenAI logo generation returned no base64 image data',
      model,
    });
    return null;
  } catch (error) {
    logger.warn({
      message: 'OpenAI logo generation failed; falling back to Gemini',
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
