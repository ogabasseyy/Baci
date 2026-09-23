type QuizAttemptSubmissionRpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>
  ): Promise<{ data: unknown; error: unknown }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export async function enrichQuizV2AttemptWithSubmissionTime(
  supabase: QuizAttemptSubmissionRpcClient,
  attempt: unknown
): Promise<{ attempt: unknown; error: unknown }> {
  if (!isRecord(attempt) || attempt.status === 'in_progress') {
    return { attempt, error: null };
  }

  const attemptId = attempt.attemptId;
  if (typeof attemptId !== 'string' || attemptId.trim().length === 0) {
    return { attempt, error: null };
  }

  const { data, error } = await supabase.rpc(
    'get_quiz_attempt_submission_time_v2',
    { p_attempt_id: attemptId }
  );
  if (error) return { attempt, error };
  if (typeof data !== 'string' || Number.isNaN(Date.parse(data))) {
    return { attempt, error: null };
  }

  return { attempt: { ...attempt, submittedAt: data }, error: null };
}

export async function enrichQuizV2ActiveResponseWithSubmissionTime(
  supabase: QuizAttemptSubmissionRpcClient,
  response: unknown
): Promise<{ response: unknown; error: unknown }> {
  if (!isRecord(response)) return { response, error: null };

  if (isRecord(response.attempt)) {
    const enriched = await enrichQuizV2AttemptWithSubmissionTime(
      supabase,
      response.attempt
    );
    return {
      response: { ...response, attempt: enriched.attempt },
      error: enriched.error,
    };
  }

  if (response.availability !== 'pending_results') {
    return { response, error: null };
  }

  const attemptId = response.attemptId;
  if (typeof attemptId !== 'string' || attemptId.trim().length === 0) {
    return { response, error: null };
  }

  const enriched = await enrichQuizV2AttemptWithSubmissionTime(supabase, {
    attemptId,
    status: 'completed',
  });
  if (enriched.error) return { response, error: enriched.error };

  const attempt = enriched.attempt;
  const submittedAt = isRecord(attempt) ? attempt.submittedAt : null;
  return {
    response: {
      ...response,
      submittedAt: typeof submittedAt === 'string' ? submittedAt : null,
    },
    error: null,
  };
}
