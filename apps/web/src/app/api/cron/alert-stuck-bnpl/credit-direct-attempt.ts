function readNoteString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

export function readCreditDirectAttempt(notes: string | null) {
  let parsed: Record<string, unknown> = {};
  if (notes) {
    try {
      const value: unknown = JSON.parse(notes);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      // Legacy free-text notes carry no reliable attempt identifiers.
    }
  }

  const session = readNoteString(parsed.creditDirectSessionId);
  const transaction =
    readNoteString(parsed.creditDirectTransactionId) ??
    readNoteString(parsed.credit_directTransactionId);
  const completedSession = readNoteString(
    parsed.creditDirectClientCompletedSessionId
  );
  const completedTransaction = readNoteString(
    parsed.creditDirectClientCompletedTransactionId
  );
  const reference = transaction ?? session;
  const supersededReferences = Array.isArray(
    parsed.creditDirectSupersededReferences
  )
    ? parsed.creditDirectSupersededReferences
        .map(readNoteString)
        .filter((value) => value !== null)
    : [];
  const completedAt = readNoteString(parsed.creditDirectClientCompletedAt);
  const hasCompletionTimestamp =
    completedAt !== null && Number.isFinite(Date.parse(completedAt));
  const hasCurrentCompletion =
    hasCompletionTimestamp &&
    (session === null || completedSession === session) &&
    (completedTransaction === null ||
      transaction === null ||
      completedTransaction === transaction) &&
    ((session !== null && completedSession === session) ||
      (transaction !== null && completedTransaction === transaction));

  return {
    reference,
    supersededReferences,
    hasCompletionTimestamp,
    hasCurrentCompletion,
  };
}
