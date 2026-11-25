import { generateObject, generateText } from 'ai';
import z from 'zod';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  activeImageModel,
  activeTextModel,
  sanitizePromptInput,
  withRetry,
} from '@/ai/provider';
import { getOnboardingTextProviderChain } from '@/ai/text-provider-chain';
import { getVisionProviderChain } from '@/ai/vision-provider-chain';
import { fetchImageBytes } from '@/lib/fetch-image-bytes';
import { logger } from '@/lib/logger';
import { guideBusinessOnboardingInputSchema } from '@/schemas/ai-guide-business-onboarding';
import { createFallbackLogo } from './fallback-logo';
import { generateOpenAiLogo } from './generate-openai-logo';

export type GuideBusinessOnboardingInput = z.infer<
  typeof guideBusinessOnboardingInputSchema
>;

const BrandColorsSchema = z.object({
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

const AI_LOGO_RETRY_CONFIG = Object.freeze({
  maxRetries: 0,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
});

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

const _GuideBusinessOnboardingOutputSchema = z.object({
  logos: z
    .array(z.string())
    .optional()
    .describe('An array of data URIs for the generated logos.'),
  brandColors: BrandColorsSchema.optional().describe(
    'A list of 3 brand colors in hex format (e.g., #RRGGBB).'
  ),
  businessNames: z
    .array(z.string())
    .optional()
    .describe('Generated business name suggestions.'),
});

export type GuideBusinessOnboardingOutput = z.infer<
  typeof _GuideBusinessOnboardingOutputSchema
>;

/**
 * Core server-side onboarding AI runner (non-Server-Action). Callers must
 * enforce their own auth and rate-limiting before invoking this function.
 */
export async function runGuideBusinessOnboarding(
  rawInput: GuideBusinessOnboardingInput
): Promise<GuideBusinessOnboardingOutput> {
  const parsedInput = guideBusinessOnboardingInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new Error('Invalid onboarding input provided.');
  }
  const input = parsedInput.data;

  if (input.task === 'extract_colors') {
    if (!input.logoUrl) {
      throw new Error('logoUrl is required for color extraction.');
    }
    const logoUrl = input.logoUrl;
    logger.info({
      message: 'Extracting colors from logo.',
      flow: 'guideBusinessOnboarding',
    });

    try {
      const imageBytes = await fetchImageBytes(logoUrl);

      const { object } = imageBytes
        ? await generateObjectWithChain({
            chain: getVisionProviderChain(),
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
          })
        : await withRetry(async () => {
            return await generateObject({
              model: activeTextModel,
              schema: BrandColorsSchema,
              messages: [
                { role: 'system', content: EXTRACT_COLORS_SYSTEM_PROMPT },
                {
                  role: 'user',
                  content: [{ type: 'image', image: logoUrl }],
                },
              ],
            });
          });

      logger.info({ message: 'Colors extracted successfully', colors: object });
      return { brandColors: object };
    } catch (error) {
      logger.error({ message: 'Color extraction failed', error });
      throw new Error('Failed to extract brand colors.');
    }
  }

  if (input.task === 'generate_logos') {
    logger.info({
      message: 'Generating logo with Gemini 2.5 Flash Image',
      flow: 'guideBusinessOnboarding',
    });

    const businessName = sanitizePromptInput(input.businessName, 100).value;
    const businessType = sanitizePromptInput(input.businessType, 50).value;
    const brandPreferences = sanitizePromptInput(
      input.brandPreferences,
      50
    ).value;

    try {
      const prompt = `Generate a professional, modern, and minimalist logo image for a business.

Business Name: "${businessName}"
Business Type: ${businessType}
Color Preferences: ${brandPreferences}

Requirements:
- Clean, vector-like design suitable for a website header and app icon
- High contrast with simple, recognizable shapes
- White or transparent background
- Professional and memorable
- The logo should work well at both large and small sizes

Please generate the logo image now.`;

      const openAiLogoDataUri = await generateOpenAiLogo(prompt);
      if (openAiLogoDataUri) {
        logger.info({
          message: 'Logo generated successfully with OpenAI',
        });
        const fallbackPalette = createFallbackLogo(
          businessName,
          businessType
        ).brandColors;
        return { logos: [openAiLogoDataUri], brandColors: fallbackPalette };
      }

      const result = await withRetry(async () => {
        return await generateText({
          model: activeImageModel,
          prompt,
          maxRetries: 0,
        });
      }, AI_LOGO_RETRY_CONFIG);

      const imageFile = result.files?.find((file) =>
        file.mediaType.startsWith('image/')
      );

      if (!imageFile?.base64) {
        logger.error({ message: 'No image generated in response' });
        throw new Error('No image generated.');
      }

      const logoDataUri = `data:${imageFile.mediaType};base64,${imageFile.base64}`;
      const fallbackPalette = createFallbackLogo(
        businessName,
        businessType
      ).brandColors;

      logger.info({
        message: 'Logo generated successfully with Gemini 2.5 Flash Image',
      });
      return { logos: [logoDataUri], brandColors: fallbackPalette };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({
        message: 'Logo generation failed',
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      const fallbackLogo = createFallbackLogo(businessName, businessType);
      return {
        logos: [fallbackLogo.logoDataUri],
        brandColors: fallbackLogo.brandColors,
      };
    }
  }

  if (input.task === 'generate_names') {
    if (!input.description) {
      throw new Error('description is required for name generation.');
    }

    logger.info({
      message: 'Generating business names',
      flow: 'guideBusinessOnboarding',
    });

    const description = sanitizePromptInput(input.description, 200).value;
    const tone = input.tone || 'Modern';

    try {
      const { object } = await generateObjectWithChain({
        chain: getOnboardingTextProviderChain(),
        schema: z.object({
          businessNames: z
            .array(z.string())
            .describe('Array of 6 creative business name suggestions'),
        }),
        messages: [
          {
            role: 'system',
            content: `You are a creative brand naming expert. Generate unique, memorable business names.

TASK: Generate 6 creative business name suggestions based on the description and tone.

REQUIREMENTS:
- Names should be short (1-3 words max)
- Easy to pronounce and spell
- Memorable and distinctive
- Reflect the business description
- Match the desired tone: ${tone}
- Avoid generic names
- Consider domain availability trends (short, unique)

OUTPUT: Return exactly 6 names as an array.

Return JSON in exactly this shape: {"businessNames": string[]}`,
          },
          {
            role: 'user',
            content: `Business Description: ${description}\nTone: ${tone}\n\nGenerate 6 creative business name suggestions.`,
          },
        ],
      });

      logger.info({
        message: 'Business names generated successfully',
        names: object.businessNames,
      });
      return { businessNames: object.businessNames };
    } catch (error) {
      logger.error({ message: 'Name generation failed', error });
      throw new Error('Failed to generate business names.');
    }
  }

  throw new Error('Invalid task provided to guideBusinessOnboarding.');
}
