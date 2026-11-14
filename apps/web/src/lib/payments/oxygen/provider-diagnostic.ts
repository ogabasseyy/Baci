import type { OxygenProviderDiagnostic } from '@/schemas/oxygen-provider-diagnostic';
import { oxygenFailureDetails } from './failure-details';
import { redactOxygenDiagnosticText } from './redact-diagnostic';

export function oxygenDiagnostic(
  operation: OxygenProviderDiagnostic['operation'],
  kind: OxygenProviderDiagnostic['kind'],
  outcome: OxygenProviderDiagnostic['outcome'],
  startedAt: number
): OxygenProviderDiagnostic {
  return {
    operation,
    kind,
    outcome,
    httpStatus: null,
    providerCode: null,
    providerMessage: null,
    providerRequestId: null,
    capture: 'not_applicable',
    occurredAt: new Date().toISOString(),
    durationMs: Math.min(300000, Math.max(0, Date.now() - startedAt)),
  };
}
function requestValues(input: Record<string, unknown> | FormData) {
  return input instanceof FormData
    ? Object.fromEntries(
        [...input.entries()].filter(([, value]) => typeof value === 'string')
      )
    : input;
}
/** Bounded, allowlisted response metadata. Never retain headers or full response bodies. */
export async function readOxygenFailureDiagnostic(
  response: Response,
  operation: NonNullable<OxygenProviderDiagnostic['operation']>,
  input: Record<string, unknown> | FormData,
  secrets: string[],
  startedAt: number,
  onDetails?: (details: string[]) => void
): Promise<OxygenProviderDiagnostic> {
  const result = oxygenDiagnostic(
    operation,
    'http',
    response.status >= 400 && response.status < 500 && response.status !== 408
      ? 'rejected'
      : 'indeterminate',
    startedAt
  );
  result.httpStatus = response.status;
  const requestId =
    response.headers.get('x-request-id') ?? response.headers.get('request-id');
  // Only correlation identifiers, never arbitrary headers, signed URLs or JWTs.
  if (
    requestId &&
    /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
      requestId
    )
  )
    result.providerRequestId = requestId;
  const reader = response.body?.getReader();
  if (!reader) {
    result.capture = 'unavailable';
    return result;
  }
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 16384) {
        await reader.cancel();
        result.capture = 'oversized';
        return result;
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      result.capture = 'non_json';
      return result;
    }
    result.capture = 'parsed';
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      return result;
    const data = body as Record<string, unknown>;
    onDetails?.(oxygenFailureDetails(data, requestValues(input), secrets));
    const message =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : null;
    if (message)
      result.providerMessage = redactOxygenDiagnosticText(
        message,
        requestValues(input),
        secrets
      );
    const code = String(data.response_code ?? '');
    if (/^[a-z0-9_-]{1,32}$/i.test(code) && !/\d{6}/.test(code))
      result.providerCode = redactOxygenDiagnosticText(
        code,
        requestValues(input),
        secrets,
        false
      ).slice(0, 32);
    return result;
  } catch {
    result.capture = 'unavailable';
    return result;
  }
}
