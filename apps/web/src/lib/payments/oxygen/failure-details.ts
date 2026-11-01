import { redactOxygenDiagnosticText } from './redact-diagnostic';

/** Bounded error messages only: never retain arbitrary error objects or identity fields. */
export function oxygenFailureDetails(
  body: unknown,
  input: unknown,
  secrets: string[]
): string[] {
  const messages: string[] = [];
  const keys = new Set([
    'message',
    'defaultMessage',
    'error',
    'detail',
    'description',
    'errors',
    'details',
    'nin',
    'bvn',
    'date_of_birth',
    'phone_number',
    'account_number',
  ]);
  function visit(value: unknown, depth: number) {
    if (depth > 4 || messages.length >= 6) return;
    if (typeof value === 'string') {
      const safe = redactOxygenDiagnosticText(value, input, secrets).slice(
        0,
        384
      );
      if (safe && !messages.includes(safe)) messages.push(safe);
    } else if (Array.isArray(value)) {
      for (const item of value.slice(0, 6)) visit(item, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value))
        if (keys.has(key)) visit(child, depth + 1);
    }
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const data = body as Record<string, unknown>;
    visit(data.errors, 0);
    visit(data.details, 0);
  }
  return messages;
}
