import type {
  QuizAdmissionTicket,
  QuizEventConfig,
  QuizQuestionOption,
  QuizQuestionSlot,
  QuizQuestionVariant,
} from '../src/contracts';
import { quizAnswerKeyHash } from '../src/crypto';

export type NigerianCarrierName = 'MTN' | 'Airtel' | 'Glo' | '9mobile';

export interface CarrierNetworkProfile {
  name: NigerianCarrierName;
  share: number;
  minRttMs: number;
  medianRttMs: number;
  p95RttMs: number;
  lossRate: number;
}

export const NIGERIAN_CARRIER_PROFILES: readonly CarrierNetworkProfile[] = [
  {
    name: 'MTN',
    share: 0.45,
    minRttMs: 80,
    medianRttMs: 112,
    p95RttMs: 165,
    lossRate: 0.006,
  },
  {
    name: 'Airtel',
    share: 0.3,
    minRttMs: 90,
    medianRttMs: 128,
    p95RttMs: 195,
    lossRate: 0.008,
  },
  {
    name: 'Glo',
    share: 0.2,
    minRttMs: 130,
    medianRttMs: 182,
    p95RttMs: 250,
    lossRate: 0.015,
  },
  {
    name: '9mobile',
    share: 0.05,
    minRttMs: 115,
    medianRttMs: 160,
    p95RttMs: 235,
    lossRate: 0.012,
  },
];

export type SeededRng = () => number;

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pickCarrier(rng: SeededRng): CarrierNetworkProfile {
  const draw = rng();
  let cumulative = 0;
  for (const profile of NIGERIAN_CARRIER_PROFILES) {
    cumulative += profile.share;
    if (draw <= cumulative) return profile;
  }
  return NIGERIAN_CARRIER_PROFILES[0] as CarrierNetworkProfile;
}

export interface CarrierSample {
  carrier: NigerianCarrierName;
  rttMs: number;
  oneWayClientToEdgeMs: number;
  oneWayEdgeToClientMs: number;
  responseLost: boolean;
}

/**
 * Samples a Nigerian mobile carrier RTT (80-250ms range with heavy-tail jitter)
 * and independent downstream response loss requiring client retry.
 */
export function sampleCarrierNetwork(
  rng: SeededRng,
  profile: CarrierNetworkProfile
): CarrierSample {
  // Box-Muller normal transformed to right-skewed latency between min and ~1.25*p95.
  const u1 = Math.max(1e-6, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const sigma = (profile.p95RttMs - profile.medianRttMs) / 1.645;
  const rawRtt =
    z >= 0
      ? profile.medianRttMs + z * sigma
      : profile.medianRttMs +
        z * ((profile.medianRttMs - profile.minRttMs) / 1.645);
  const rttMs = Math.max(
    profile.minRttMs,
    Math.min(Math.round(profile.p95RttMs * 1.35), Math.round(rawRtt))
  );
  const uplinkShare = 0.45 + rng() * 0.1;
  const oneWayClientToEdgeMs = Math.round(rttMs * uplinkShare);
  const oneWayEdgeToClientMs = rttMs - oneWayClientToEdgeMs;
  return {
    carrier: profile.name,
    rttMs,
    oneWayClientToEdgeMs,
    oneWayEdgeToClientMs,
    responseLost: rng() < profile.lossRate,
  };
}

export async function buildBenchmarkEventConfig(options: {
  eventId: string;
  merchantId?: string;
  startsAtMs: number;
  endsAtMs: number;
  questionCount?: number;
  timePerQuestionSeconds?: number;
  variantsPerSlot?: number;
}): Promise<QuizEventConfig> {
  const questionCount = options.questionCount ?? 10;
  const timePerQuestionSeconds = options.timePerQuestionSeconds ?? 10;
  const variantsPerSlot = options.variantsPerSlot ?? 3;
  const slots: QuizQuestionSlot[] = [];

  for (let s = 0; s < questionCount; s += 1) {
    const slotId = `slot-${String(s + 1).padStart(2, '0')}`;
    const variants: QuizQuestionVariant[] = [];
    for (let v = 0; v < variantsPerSlot; v += 1) {
      const variantId = `${slotId}-var-${v + 1}`;
      const correctOptionId = `opt-a`;
      const answerKeyHash = await quizAnswerKeyHash(correctOptionId);
      const opts: QuizQuestionOption[] = [
        { id: 'opt-a', label: `Correct choice Q${s + 1}V${v + 1}` },
        { id: 'opt-b', label: `Distractor B Q${s + 1}V${v + 1}` },
        { id: 'opt-c', label: `Distractor C Q${s + 1}V${v + 1}` },
        { id: 'opt-d', label: `Distractor D Q${s + 1}V${v + 1}` },
      ];
      variants.push({
        id: variantId,
        slotId,
        prompt: `Benchmark question ${s + 1} variant ${v + 1}`,
        options: opts,
        answerKeyHash,
        active: true,
      });
    }
    slots.push({
      id: slotId,
      slotIndex: s + 1,
      active: true,
      variants,
    });
  }

  return {
    eventId: options.eventId,
    merchantId: options.merchantId ?? 'merchant-ogabassey',
    mode: 'live',
    contractVersion: 2,
    rulesVersion: '2026-11',
    questionCount,
    timePerQuestionSeconds,
    maxAttempts: 1,
    startsAtMs: options.startsAtMs,
    endsAtMs: options.endsAtMs,
    status: 'active',
    slots,
    retentionPeriodMs: 7 * 24 * 60 * 60 * 1000,
    scoreboardTickMs: 5_000,
    flushTickMs: 2_000,
  };
}

export type ArrivalProfile =
  | 'uniform_10m'
  | 'surge_30s_50pct'
  | 'all_active_burst';

export function generateArrivalOffsetsMs(
  entrantCount: number,
  profile: ArrivalProfile,
  rng: SeededRng
): number[] {
  const offsets = new Array<number>(entrantCount);
  if (profile === 'uniform_10m') {
    for (let i = 0; i < entrantCount; i += 1) {
      offsets[i] = Math.floor(rng() * 600_000);
    }
    return offsets;
  }
  if (profile === 'surge_30s_50pct') {
    const surgeCount = Math.floor(entrantCount * 0.5);
    for (let i = 0; i < entrantCount; i += 1) {
      offsets[i] =
        i < surgeCount
          ? Math.floor(rng() * 30_000)
          : 30_000 + Math.floor(rng() * 570_000);
    }
    return offsets;
  }
  for (let i = 0; i < entrantCount; i += 1) {
    offsets[i] = Math.floor(rng() * 2_000);
  }
  return offsets;
}

export function assignDeterministicRoomId(
  eventId: string,
  entrantIndex: number,
  roomCount: number
): string {
  const shard = entrantIndex % Math.max(1, roomCount);
  return `room-${eventId}-${String(shard).padStart(4, '0')}`;
}

export function makeSyntheticTicket(options: {
  eventId: string;
  merchantId: string;
  roomId: string;
  index: number;
  expiresAtMs: number;
  issuedAtMs: number;
}): QuizAdmissionTicket {
  const idStr = String(options.index).padStart(7, '0');
  return {
    userId: `user-${idStr}`,
    customerId: `cust-${idStr}`,
    merchantId: options.merchantId,
    eventId: options.eventId,
    roomId: options.roomId,
    deviceHash: `dev-${idStr}`.padEnd(32, '0'),
    leaderboardUsername: `player_${idStr}`,
    expiresAtMs: options.expiresAtMs,
    admissionId: `adm-${idStr}`,
    mode: 'live',
    issuedAtMs: options.issuedAtMs,
  };
}

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor(clamped * (sortedAsc.length - 1))
  );
  return sortedAsc[idx] ?? 0;
}
