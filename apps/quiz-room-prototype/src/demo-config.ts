import type { QuizEventConfig, QuizQuestionSlot } from './contracts';
import { quizAnswerKeyHash } from './crypto';

export async function buildDemoEventConfig(params: {
  eventId: string;
  merchantId: string;
  startsAtMs: number;
  endsAtMs: number;
}): Promise<QuizEventConfig> {
  const answerHash = await quizAnswerKeyHash('opt-a');
  const slots: QuizQuestionSlot[] = Array.from({ length: 10 }, (_, idx) => {
    const qNum = idx + 1;
    const slotId = `00000000-0000-4000-8000-${String(qNum).padStart(12, '0')}`;
    return {
      id: slotId,
      slotIndex: qNum,
      active: true,
      variants: [1, 2, 3].map((v) => ({
        id: `10000000-0000-4000-8000-${String(qNum * 10 + v).padStart(12, '0')}`,
        slotId,
        prompt: `Round Question ${qNum} (Variant ${v}): Which option wins?`,
        options: [
          { id: 'opt-a', label: 'A — Verified Correct Answer' },
          { id: 'opt-b', label: 'B — Distractor Two' },
          { id: 'opt-c', label: 'C — Distractor Three' },
          { id: 'opt-d', label: 'D — Distractor Four' },
        ],
        answerKeyHash: answerHash,
        active: true,
      })),
    };
  });
  return {
    eventId: params.eventId,
    merchantId: params.merchantId,
    mode: 'live',
    contractVersion: 2,
    rulesVersion: 'live-v1',
    questionCount: 10,
    timePerQuestionSeconds: 10,
    maxAttempts: 1,
    startsAtMs: params.startsAtMs,
    endsAtMs: params.endsAtMs,
    status: 'active',
    slots,
  };
}
