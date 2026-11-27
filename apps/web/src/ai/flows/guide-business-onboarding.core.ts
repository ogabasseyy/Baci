import { generateText } from 'ai';
import z from 'zod';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  activeImageModel,
  sanitizePromptInput,
  withRetry,
} from '@/ai/provider';
import {
  getOnboardingTextProviderChain,
  getTextProviderChain,
} from '@/ai/text-provider-chain';
import { logger } from '@/lib/logger';
import { guideBusinessOnboardingInputSchema } from '@/schemas/ai-guide-business-onboarding';
import {
  BrandColorsSchema,
  extractBrandColorsFromDataUriBestEffort,
  extractBrandColorsFromUrl,
} from './extract-onboarding-brand-colors';
import { createFallbackLogo } from './fallback-logo';
import { generateOpenAiLogo } from './generate-openai-logo';

export type GuideBusinessOnboardingInput = z.infer<
  typeof guideBusinessOnboardingInputSchema
>;

const AI_LOGO_RETRY_CONFIG = Object.freeze({
  maxRetries: 0,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
});

const ONBOARDING_CHAIN_TIMEOUT_MS = 40_000;
const LOGO_GENERATION_TOTAL_BUDGET_MS = 45_000;
const OPENAI_LOGO_BUDGET_MS = 14_000;
const LOGO_COLOR_EXTRACT_RESERVE_MS = 10_000;
const MIN_GEMINI_LOGO_BUDGET_MS = 3_000;

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

export interface RunGuideBusinessOnboardingOptions {
  /**
   * Enables paid OpenAI-first routing (image + text). Must only be set by
   * authenticated, Redis fail-closed rate-limited callers such as the mobile
   * onboarding-assist route — never by the anonymous web server action.
   */
  allowPaidOpenAi?: boolean;
}

/**
 * Core server-side onboarding AI runner (non-Server-Action). Callers must
 * enforce their own auth and rate-limiting before invoking this function.
 */
export async function runGuideBusinessOnboarding(
  rawInput: GuideBusinessOnboardingInput,
  options: RunGuideBusinessOnboardingOptions = {}
): Promise<GuideBusinessOnboardingOutput> {
  const allowPaidOpenAi = options.allowPaidOpenAi === true;
  const parsedInput = guideBusinessOnboardingInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new Error('Invalid onboarding input provided.');
  }
  const input = parsedInput.data;

  if (input.task === 'extract_colors') {
    if (!input.logoUrl) {
      throw new Error('logoUrl is required for color extraction.');
    }
    const brandColors = await extractBrandColorsFromUrl(
      input.logoUrl,
      allowPaidOpenAi
    );
    return { brandColors };
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

      const logoDeadline = Date.now() + LOGO_GENERATION_TOTAL_BUDGET_MS;
      const openAiBudgetMs = Math.min(
        OPENAI_LOGO_BUDGET_MS,
        Math.max(0, logoDeadline - Date.now() - LOGO_COLOR_EXTRACT_RESERVE_MS)
      );
      const openAiLogoDataUri =
        allowPaidOpenAi && openAiBudgetMs >= 1_000
          ? await generateOpenAiLogo(prompt, {
              timeoutMs: openAiBudgetMs,
              signal: AbortSignal.timeout(openAiBudgetMs),
            })
          : null;
      if (openAiLogoDataUri) {
        logger.info({
          message: 'Logo generated successfully with OpenAI',
        });
        const brandColors = await extractBrandColorsFromDataUriBestEffort(
          openAiLogoDataUri,
          businessName,
          businessType,
          Math.max(0, logoDeadline - Date.now()),
          allowPaidOpenAi
        );
        return { logos: [openAiLogoDataUri], brandColors };
      }

      const geminiBudgetMs =
        logoDeadline - Date.now() - LOGO_COLOR_EXTRACT_RESERVE_MS;
      if (geminiBudgetMs < MIN_GEMINI_LOGO_BUDGET_MS) {
        throw new Error('Logo generation deadline exceeded before fallback.');
      }

      const result = await withRetry(async () => {
        return await generateText({
          model: activeImageModel,
          prompt,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(geminiBudgetMs),
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
      const brandColors = await extractBrandColorsFromDataUriBestEffort(
        logoDataUri,
        businessName,
        businessType,
        Math.max(0, logoDeadline - Date.now()),
        allowPaidOpenAi
      );

      logger.info({
        message: 'Logo generated successfully with Gemini 2.5 Flash Image',
      });
      return { logos: [logoDataUri], brandColors };
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
    const tone =
      sanitizePromptInput(input.tone || 'Modern', 50).value || 'Modern';

    try {
      const { object } = await generateObjectWithChain({
        chain: allowPaidOpenAi
          ? getOnboardingTextProviderChain()
          : getTextProviderChain(),
        overallTimeoutMs: ONBOARDING_CHAIN_TIMEOUT_MS,
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
