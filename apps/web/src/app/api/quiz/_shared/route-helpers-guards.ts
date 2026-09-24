import type { User } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { enforcePrizeProductionGuard } from '@/lib/quiz-compliance-gate';
import {
  calculateQuizAgeYears,
  parseQuizDateOfBirth,
  QUIZ_MINIMUM_AGE_YEARS,
} from './route-helpers-age';

type QuizSupabaseQueryResult<TData = unknown> = {
  data: TData;
  error: unknown;
};

type QuizSupabaseQueryBuilder = {
  eq(column: string, value: string): QuizSupabaseQueryBuilder;
  limit(count: number): QuizSupabaseQueryBuilder;
  maybeSingle(): Promise<QuizSupabaseQueryResult>;
  order(
    column: string,
    options?: { ascending?: boolean }
  ): QuizSupabaseQueryBuilder;
  range(from: number, to: number): Promise<QuizSupabaseQueryResult>;
  select(columns: string): QuizSupabaseQueryBuilder;
};

export type ServerSupabaseClient = {
  auth: {
    getUser(): Promise<{
      data: { user: User | null };
      error: unknown;
    }>;
  };
  from(table: string): QuizSupabaseQueryBuilder;
  rpc(
    functionName: string,
    args?: Record<string, unknown>
  ): Promise<QuizSupabaseQueryResult>;
};

type QuizAwardPrizeGuardEventRow = {
  compliance_verified?: boolean | null;
  merchant_id?: string | null;
  mode?: string | null;
  regulatory_basis?: string | null;
  regulatory_evidence_ref?: string | null;
  regulatory_jurisdiction?: string | null;
};

type QuizAwardPrizeGuardRow = {
  quiz_events?:
    | QuizAwardPrizeGuardEventRow
    | QuizAwardPrizeGuardEventRow[]
    | null;
};

export class QuizAgeGateError extends Error {
  readonly code = 'quiz_age_restricted';
  readonly status = 403;
}

export class QuizUsernameRequiredError extends Error {
  readonly code = 'quiz_username_required';
  readonly status = 409;
}

export async function enforceEventPrizeGuard(
  supabase: ServerSupabaseClient,
  eventId: string
) {
  const { data, error } = await supabase
    .from('quiz_events')
    .select(
      'merchant_id, mode, regulatory_basis, regulatory_jurisdiction, regulatory_evidence_ref, compliance_verified'
    )
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    logger.error({
      message: 'Quiz event prize guard lookup failed',
      error,
      eventId,
    });
    throw new Error(`Quiz event prize guard lookup failed for ${eventId}`);
  }

  const eventRow = data as QuizAwardPrizeGuardEventRow | null;
  if (!eventRow) {
    logger.warn({
      message: 'Quiz event prize guard missing event row',
      eventId,
    });
  }

  // Test-mode rehearsals never populate regulatory evidence (test activation
  // bypasses the live launch RPC and rejects compliance payloads), so exempt
  // only explicit test rows. Fail closed for missing rows and every other
  // mode: production prize flows require positive compliance evidence.
  if (eventRow?.mode !== 'test') {
    enforcePrizeProductionGuard(
      {
        regulatory_basis: eventRow?.regulatory_basis,
        regulatory_evidence_ref: eventRow?.regulatory_evidence_ref,
        regulatory_jurisdiction: eventRow?.regulatory_jurisdiction,
      },
      eventRow?.compliance_verified === true
    );
  }

  return {
    merchantId:
      typeof eventRow?.merchant_id === 'string' ? eventRow.merchant_id : null,
  };
}

export async function enforceQuizAgeGate(
  supabase: ServerSupabaseClient,
  merchantId: string | null,
  userId: string
) {
  if (!merchantId) {
    logger.warn({
      message: 'Quiz age gate missing merchant context',
      userId,
    });
    throw new QuizAgeGateError('Quiz age verification requires merchant scope');
  }

  const { data, error } = await supabase
    .from('customers')
    .select('date_of_birth')
    .eq('merchant_id', merchantId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error({
      error,
      merchantId,
      message: 'Quiz age gate customer lookup failed',
      userId,
    });
    throw new Error(`Quiz age gate customer lookup failed for ${userId}`);
  }

  const customer = data as { date_of_birth?: string | null } | null;
  const dateOfBirth =
    typeof customer?.date_of_birth === 'string' ? customer.date_of_birth : null;
  const parsedDate = dateOfBirth ? parseQuizDateOfBirth(dateOfBirth) : null;

  if (!parsedDate) {
    logger.warn({
      merchantId,
      message: 'Quiz age gate missing or invalid date_of_birth',
      userId,
    });
    throw new QuizAgeGateError('Quiz participation requires date of birth');
  }

  if (calculateQuizAgeYears(parsedDate, new Date()) < QUIZ_MINIMUM_AGE_YEARS) {
    logger.warn({
      merchantId,
      message: 'Quiz age gate blocked underage customer',
      userId,
    });
    throw new QuizAgeGateError('Quiz participation is age restricted');
  }
}

export async function enforceQuizUsernameGate(
  supabase: ServerSupabaseClient,
  merchantId: string | null,
  userId: string
) {
  if (!merchantId) {
    logger.warn({
      message: 'Quiz username gate missing merchant context',
      userId,
    });
    throw new QuizUsernameRequiredError(
      'Quiz participation requires merchant scope'
    );
  }

  const { data, error } = await supabase
    .from('customers')
    .select('username')
    .eq('merchant_id', merchantId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error({
      error,
      merchantId,
      message: 'Quiz username gate customer lookup failed',
      userId,
    });
    throw new Error(`Quiz username gate customer lookup failed for ${userId}`);
  }

  const customer = data as { username?: string | null } | null;
  const username =
    typeof customer?.username === 'string' ? customer.username.trim() : '';

  // Leaderboard-bound attempts must carry a display name. The mobile UI gates
  // this before starting, but the server is the authoritative invariant so a
  // web caller or crafted/stale mobile request cannot create a nameless
  // leaderboard attempt (and be charged the exam pass) by posting directly.
  if (!username) {
    logger.warn({
      merchantId,
      message: 'Quiz username gate blocked customer without display name',
      userId,
    });
    throw new QuizUsernameRequiredError(
      'Quiz participation requires a leaderboard display name'
    );
  }
}

export async function enforceCashAwardPrizeGuard(
  supabase: ServerSupabaseClient,
  awardId: string
) {
  const { data, error } = await supabase
    .from('quiz_awards')
    .select(
      'quiz_events(regulatory_basis, regulatory_jurisdiction, regulatory_evidence_ref, compliance_verified)'
    )
    .eq('id', awardId)
    .maybeSingle();
  if (error) {
    logger.error({
      message: 'Quiz cash award prize guard lookup failed',
      awardId,
      error,
    });
    throw new Error(`Quiz cash award prize guard lookup failed for ${awardId}`);
  }

  const awardRow = data as QuizAwardPrizeGuardRow | null;
  if (!awardRow) {
    logger.warn({
      message: 'Quiz cash award prize guard missing award row',
      awardId,
    });
  }
  // Supabase foreign-key joins can still return arrays; normalize the
  // awardRow?.quiz_events join shape through rawEventRow before guard checks.
  const rawEventRow = awardRow?.quiz_events;
  const eventRow = Array.isArray(rawEventRow) ? rawEventRow[0] : rawEventRow;
  if (
    rawEventRow !== undefined &&
    rawEventRow !== null &&
    typeof rawEventRow !== 'object'
  ) {
    logger.warn({
      message: 'Quiz cash award prize guard unexpected event join shape',
      awardId,
      joinType: typeof rawEventRow,
    });
  }

  // Fail closed: nullable event fields cannot satisfy production guard checks.
  enforcePrizeProductionGuard(
    {
      regulatory_basis: eventRow?.regulatory_basis,
      regulatory_evidence_ref: eventRow?.regulatory_evidence_ref,
      regulatory_jurisdiction: eventRow?.regulatory_jurisdiction,
    },
    eventRow?.compliance_verified === true
  );
}
