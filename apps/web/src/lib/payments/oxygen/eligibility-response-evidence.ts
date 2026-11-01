import 'server-only';

/** Bounded business fields only: never retain identifiers, messages or arbitrary values. */
export function projectEligibilityEvidence(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const input = body as Record<string, unknown>;
  const shape: Record<string, string> = {};
  const values: Record<string, string | number | boolean> = {};
  for (const field of [
    'loan_request_reference',
    'partner_reference',
    'status',
    'is_eligible',
    'eligible_amount',
    'max_loan_amount',
    'minimum_loan_amount',
    'max_tenure',
  ]) {
    const value = input[field];
    shape[field] = !Object.hasOwn(input, field)
      ? 'missing'
      : value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value;
    if (field === 'status' && typeof value === 'string') {
      values.status = ['COMPLETED', 'FAILED', 'PENDING', 'PROCESSING'].includes(
        value
      )
        ? value
        : 'UNKNOWN';
    } else if (field === 'is_eligible' && typeof value === 'boolean') {
      values[field] = value;
    } else if (
      [
        'eligible_amount',
        'max_loan_amount',
        'minimum_loan_amount',
        'max_tenure',
      ].includes(field) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER / 100
    ) {
      values[field] = value;
    }
  }
  return { eligibility: { shape, values } };
}
