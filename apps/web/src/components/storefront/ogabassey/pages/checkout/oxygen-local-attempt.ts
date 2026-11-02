/** Explicit local-only test attempts never reset or replay an existing workflow. */
export function oxygenLocalAttempt(
  params: Pick<URLSearchParams, 'get'>,
  enabled = process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT === 'true'
) {
  const attempt = params.get('oxygenTestAttempt');
  const source = params.get('oxygenDraftSource');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!enabled || !attempt || !uuid.test(attempt)) return null;
  return { attempt, source: source && uuid.test(source) ? source : null };
}
