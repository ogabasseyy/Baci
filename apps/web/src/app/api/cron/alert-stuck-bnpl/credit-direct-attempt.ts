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
  const supersededReferences: unknown[] = Array.isArray(
    parsed.creditDirectSupersededReferences
  )
    ? parsed.creditDirectSupersededReferences
    : [];
  const hasCurrentCompletion =
    Boolean(readNoteString(parsed.creditDirectClientCompletedAt)) &&
    (session === null || completedSession === session) &&
    (completedTransaction === null ||
      transaction === null ||
      completedTransaction === transaction) &&
    ((session !== null && completedSession === session) ||
      (transaction !== null && completedTransaction === transaction));

  return { reference, supersededReferences, hasCurrentCompletion };
}
