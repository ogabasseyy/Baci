import { redactOxygenDiagnosticText } from '../../src/lib/payments/oxygen/redact-diagnostic';
// Local operator display only. Durable runtime diagnostics have a separate private contract.
export function safeProviderDiagnostic(
  data: unknown,
  payload: unknown,
  secrets: string[]
): string | undefined {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('message' in data) ||
    typeof data.message !== 'string'
  )
    return undefined;
  return redactOxygenDiagnosticText(data.message, payload, secrets);
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
// Types only, never values: even unfamiliar PII/error fields cannot be echoed.
export function shape(value: unknown, depth = 0): unknown {
  if (depth > 3) return 'nested';
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return Object.fromEntries(
    Object.entries(record(value))
      .slice(0, 50)
      .map(([key, item]) => [
        // Restrict field names too: unexpected user-controlled keys are not echoed.
        /^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(key) ? key : 'unknown_field',
        /token|secret|signature|document|bvn|nin|otp/i.test(key)
          ? 'redacted'
          : shape(item, depth + 1),
      ])
  );
}

export function parseBanks(
  data: unknown
): { name: string; code: string }[] | undefined {
  const fields = record(data);
  const rows = fields.Result;
  if (
    fields.Status !== '00' ||
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > 500
  )
    return undefined;
  if (
    rows.some((row) => {
      const bank = record(row);
      return (
        typeof bank.Name !== 'string' ||
        bank.Name.trim().length === 0 ||
        bank.Name.length > 150 ||
        typeof bank.SortCode !== 'string' ||
        !/^\d{3,10}$/.test(bank.SortCode)
      );
    })
  )
    return undefined;
  return rows.map((row) => {
    const bank = record(row);
    return { name: String(bank.Name), code: String(bank.SortCode) };
  });
}
