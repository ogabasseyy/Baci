import z from 'zod';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import { getVisionProviderChain } from '@/ai/vision-provider-chain';
import { fetchImageBytes } from '@/lib/fetch-image-bytes';
import { isPublicHttpUrl } from '@/lib/is-public-http-url';
import { logger } from '@/lib/logger';
import { parseBrandColors } from '@/schemas/brand-colors';
import { createFallbackLogo } from './fallback-logo';

export const BrandColorsSchema = z.object({
  primary: z.string().describe('The primary color, most dominant in the logo.'),
  background: z
    .string()
    .describe(
      'The background color, should be light and suitable for a page background. Prefer white or off-white.'
    ),
  accent: z
    .string()
    .describe('An accent color for highlights and calls-to-action.'),
});

export type OnboardingBrandColors = z.infer<typeof BrandColorsSchema>;

const ONBOARDING_CHAIN_TIMEOUT_MS = 40_000;
const COLOR_EXTRACT_TIMEOUT_MS = 12_000;

const EXTRACT_COLORS_SYSTEM_PROMPT = `You are a professional brand designer analyzing a logo image.
TASK: Extract exactly 3 brand colors from this logo in hex format.
INSTRUCTIONS:
1. Primary color = The MOST DOMINANT color in the logo (usually the main brand color).
2. Background color = A LIGHT, neutral color. Prefer pure white (#FFFFFF) or a very light off-white/grey from the logo that is suitable for a page background.
3. Accent color = A complementary or highlight color that stands out from the primary color.
IMPORTANT:
- Look at the actual colors IN THE LOGO IMAGE.
- Return colors as they appear in the logo, unless a background color must be generated.
- Ensure the background color is very light for good readability.
OUTPUT: Return JSON only, in exactly this shape (hex strings, no extra keys):
{"primary": "#RRGGBB", "background": "#RRGGBB", "accent": "#RRGGBB"}`;

export async function extractBrandColorsFromDataUriBestEffort(
  dataUri: string,
  businessName: string,
  businessType: string
): Promise<OnboardingBrandColors> {
  const fallback = createFallbackLogo(businessName, businessType).brandColors;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(
    dataUri.trim()
  );
  if (!match) return fallback;

  try {
    const [, mediaType, base64] = match;
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    const { object } = await generateObjectWithChain({
      chain: getVisionProviderChain(),
      overallTimeoutMs: COLOR_EXTRACT_TIMEOUT_MS,
      schema: BrandColorsSchema,
      messages: [
        { role: 'system', content: EXTRACT_COLORS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [{ type: 'image', image: bytes, mediaType }],
        },
      ],
    });
    const validated = parseBrandColors(object);
    return validated
      ? {
          primary: validated.primary,
          background: validated.background,
          accent: validated.accent,
        }
      : fallback;
  } catch {
    return fallback;
  }
}

export async function extractBrandColorsFromUrl(
  logoUrl: string
): Promise<OnboardingBrandColors> {
  let parsedLogoUrl: URL;
  try {
    parsedLogoUrl = new URL(logoUrl);
  } catch {
    logger.warn({
      message: 'Rejected malformed logoUrl for color extraction.',
      flow: 'guideBusinessOnboarding',
    });
    throw new Error('Failed to extract brand colors.');
  }

  if (!(await isPublicHttpUrl(parsedLogoUrl))) {
    logger.warn({
      message: 'Rejected non-public logoUrl for color extraction.',
      flow: 'guideBusinessOnboarding',
    });
    throw new Error('Failed to extract brand colors.');
  }

  logger.info({
    message: 'Extracting colors from logo.',
    flow: 'guideBusinessOnboarding',
  });

  try {
    const imageBytes = await fetchImageBytes(logoUrl);
    if (!imageBytes) {
      logger.warn({
        message:
          'Guarded logo image fetch returned no bytes; failing closed without raw-URL fallback.',
        flow: 'guideBusinessOnboarding',
      });
      throw new Error('Failed to extract brand colors.');
    }

    const { object } = await generateObjectWithChain({
      chain: getVisionProviderChain(),
      overallTimeoutMs: ONBOARDING_CHAIN_TIMEOUT_MS,
      schema: BrandColorsSchema,
      messages: [
        { role: 'system', content: EXTRACT_COLORS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: imageBytes.bytes,
              mediaType: imageBytes.mediaType,
            },
          ],
        },
      ],
    });

    const validated = parseBrandColors(object);
    if (!validated) {
      logger.warn({
        message: 'Vision model returned invalid brand color values.',
        flow: 'guideBusinessOnboarding',
      });
      throw new Error('Failed to extract brand colors.');
    }

    const brandColors: OnboardingBrandColors = {
      primary: validated.primary,
      background: validated.background,
      accent: validated.accent,
    };
    logger.info({
      message: 'Colors extracted successfully',
      colors: brandColors,
    });
    return brandColors;
  } catch (error) {
    logger.error({ message: 'Color extraction failed', error });
    throw new Error('Failed to extract brand colors.');
  }
}
