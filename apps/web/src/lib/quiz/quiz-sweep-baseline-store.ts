import { getRedis } from '@/lib/redis';
import type {
  QuizSweepWatermarks,
  QuizTableProbeStatus,
  QuizTableSweepWatermark,
} from './quiz-sweep-boundary-state';

const QUIZ_SWEEP_BASELINE_KEY = 'quiz:finalize:sweep-baseline:v1';
const QUIZ_SWEEP_BASELINE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface QuizSweepBaseline {
  watermarks: QuizSweepWatermarks;
  hasPendingRecoverySweep: boolean;
}

interface SerializedTableWatermark {
  status: QuizTableProbeStatus;
  floor: string;
  boundarySnapshots: [string, string][];
}

interface SerializedSweepBaseline {
  events: SerializedTableWatermark;
  reservations: SerializedTableWatermark;
  awards: SerializedTableWatermark;
  hasPendingRecoverySweep: boolean;
}

let inMemoryBaseline: QuizSweepBaseline | null = null;

function serializeTable(
  table: QuizTableSweepWatermark
): SerializedTableWatermark {
  return {
    status: table.status,
    floor: table.floor,
    boundarySnapshots: Array.from(table.boundarySnapshots.entries()),
  };
}

function deserializeTable(raw: unknown): QuizTableSweepWatermark | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    (record.status !== 'ok' &&
      record.status !== 'empty' &&
      record.status !== 'error') ||
    typeof record.floor !== 'string' ||
    !Array.isArray(record.boundarySnapshots)
  ) {
    return null;
  }
  const boundarySnapshots = new Map<string, string>();
  for (const entry of record.boundarySnapshots) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string'
    ) {
      return null;
    }
    boundarySnapshots.set(entry[0], entry[1]);
  }
  return {
    status: record.status,
    floor: record.floor,
    boundarySnapshots,
  };
}

function serializeBaseline(
  baseline: QuizSweepBaseline
): SerializedSweepBaseline {
  return {
    events: serializeTable(baseline.watermarks.events),
    reservations: serializeTable(baseline.watermarks.reservations),
    awards: serializeTable(baseline.watermarks.awards),
    hasPendingRecoverySweep: baseline.hasPendingRecoverySweep,
  };
}

function deserializeBaseline(raw: unknown): QuizSweepBaseline | null {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const events = deserializeTable(record.events);
  const reservations = deserializeTable(record.reservations);
  const awards = deserializeTable(record.awards);
  if (
    !events ||
    !reservations ||
    !awards ||
    typeof record.hasPendingRecoverySweep !== 'boolean'
  ) {
    return null;
  }
  return {
    watermarks: {
      events,
      reservations,
      awards,
      hasProbeFailure: false,
    },
    hasPendingRecoverySweep: record.hasPendingRecoverySweep,
  };
}

export function resetQuizSweepBaselineForTests() {
  inMemoryBaseline = null;
}

export async function loadQuizSweepBaseline(): Promise<{
  baseline: QuizSweepBaseline | null;
  requiresColdStartSweep: boolean;
}> {
  const redis = getRedis();
  if (!redis) {
    return {
      baseline: inMemoryBaseline,
      requiresColdStartSweep: false,
    };
  }

  try {
    const raw = await redis.get<unknown>(QUIZ_SWEEP_BASELINE_KEY);
    if (raw === null || raw === undefined) {
      return {
        baseline: inMemoryBaseline,
        requiresColdStartSweep: inMemoryBaseline === null,
      };
    }
    const deserialized = deserializeBaseline(raw);
    if (!deserialized) {
      return {
        baseline: inMemoryBaseline,
        requiresColdStartSweep: true,
      };
    }
    inMemoryBaseline = deserialized;
    return {
      baseline: deserialized,
      requiresColdStartSweep: false,
    };
  } catch {
    return {
      baseline: inMemoryBaseline,
      requiresColdStartSweep: true,
    };
  }
}

export async function saveQuizSweepBaseline(
  baseline: QuizSweepBaseline
): Promise<void> {
  inMemoryBaseline = baseline;
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.set(QUIZ_SWEEP_BASELINE_KEY, serializeBaseline(baseline), {
      ex: QUIZ_SWEEP_BASELINE_TTL_SECONDS,
    });
  } catch {
    // Keep in-memory baseline; next cold start without Redis entry will sweep once.
  }
}
