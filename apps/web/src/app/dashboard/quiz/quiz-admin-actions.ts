import { apiPost } from '@/lib/api-client';
import {
  type MerchantQuizActivationInput,
  type MerchantQuizActivationResponse,
  type MerchantQuizActivationV2Input,
  type MerchantQuizGenerationResponse,
  merchantQuizActivationResponseSchema,
  merchantQuizGenerationResponseSchema,
} from '@/schemas/quiz';
import type { QuizPrizeProduct } from '@/schemas/quiz-prize-product';

const QUIZ_GENERATE_ENDPOINT = '/api/merchant/quiz/generate';
// Activation is a separate, cheap request; it posts to its own path so it is
// not throttled by the expensive Gemma-generation rate-limit bucket.
const QUIZ_ACTIVATE_ENDPOINT = '/api/merchant/quiz/activate';

export type QuizDraftConfiguration = {
  difficulty: 'easy' | 'standard' | 'hard';
  liveWindowMinutes: number;
  mode: 'test' | 'live';
  prizeProduct: QuizPrizeProduct;
  questionCountPerTopic: number;
  scheduledEnd: string;
  scheduledStart: string;
  timePerQuestionSeconds: number;
  timingKind: 'immediate' | 'scheduled';
  title: string;
  topics: string[];
};

export function topicsFromTextarea(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((topic) => topic.trim())
    .filter(Boolean);
}

export function clampNumber(
  value: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampNumberInput(
  value: string,
  minimum: number,
  maximum: number
): string {
  return String(clampNumber(Number(value), minimum, maximum));
}

export function isQuizDifficulty(
  value: string
): value is 'easy' | 'standard' | 'hard' {
  return value === 'easy' || value === 'standard' || value === 'hard';
}

function formatValidationSummary(
  issues: { message: string; path: PropertyKey[] }[]
): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
    .join('; ');
}

export interface GenerateQuizDraftInput {
  difficulty: 'easy' | 'standard' | 'hard';
  mode: 'test' | 'live';
  prizeProduct: QuizPrizeProduct;
  questionCountPerTopic: number;
  timeLimitSeconds: number;
  title: string;
  topics: string[];
}

export interface QuizLaunchInput {
  maxAttempts: number;
  mode: 'test' | 'live';
  regulatoryCompliance?: MerchantQuizActivationV2Input['regulatoryCompliance'];
  rulesVersion: string;
  timePerQuestionSeconds: number;
  timeZone: string;
  timing:
    | { kind: 'immediate'; liveWindowSeconds: number }
    | { kind: 'scheduled'; startsAt: string; endsAt: string };
  variantsPerQuestion: number;
}

export type QuizAnswerKeyReview =
  MerchantQuizActivationInput['answerKeyReview'];

export function buildQuizAnswerKeyReview(
  questions: MerchantQuizGenerationResponse['questions']
): QuizAnswerKeyReview {
  return {
    questions: questions.map((question, index) => ({
      correctOptionId: question.correctOptionId,
      position: index + 1,
    })),
  };
}

export async function generateQuizDraft(
  input: GenerateQuizDraftInput
): Promise<MerchantQuizGenerationResponse> {
  const normalizedTopics = input.topics
    .map((topic) => topic.trim())
    .filter(Boolean);
  if (normalizedTopics.length === 0) {
    throw new Error('Add at least one quiz topic before generating.');
  }
  if (!input.prizeProduct.available) {
    throw new Error('Select an active product prize before generating.');
  }

  const parsed = merchantQuizGenerationResponseSchema.safeParse(
    await apiPost(QUIZ_GENERATE_ENDPOINT, {
      difficulty: input.difficulty,
      mode: input.mode,
      prizeCondition: input.prizeProduct.condition,
      prizeEffectiveStock: input.prizeProduct.effectiveStock,
      prizeImageUrl: input.prizeProduct.imageUrl,
      prizeProductId: input.prizeProduct.id,
      ...(input.prizeProduct.variantId
        ? { prizeVariantId: input.prizeProduct.variantId }
        : {}),
      questionCountPerTopic: input.questionCountPerTopic,
      timeLimitSeconds: input.timeLimitSeconds,
      title: input.title,
      topics: normalizedTopics,
    })
  );
  if (!parsed.success) {
    const validationSummary = formatValidationSummary(parsed.error.issues);
    console.error('Invalid quiz generation response', parsed.error);
    throw new Error(`Invalid quiz generation response: ${validationSummary}`);
  }
  return parsed.data;
}

export async function activateQuizEvent(
  eventId: string,
  answerKeyReview: QuizAnswerKeyReview,
  launch: QuizLaunchInput
): Promise<MerchantQuizActivationResponse> {
  const parsed = merchantQuizActivationResponseSchema.safeParse(
    await apiPost(QUIZ_ACTIVATE_ENDPOINT, {
      answerKeyReview,
      confirmActivation: true,
      eventId,
      ...launch,
    })
  );
  if (!parsed.success) {
    const validationSummary = formatValidationSummary(parsed.error.issues);
    console.error('Invalid quiz activation response', parsed.error);
    throw new Error(`Invalid quiz activation response: ${validationSummary}`);
  }
  return parsed.data;
}
