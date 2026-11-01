import {
  record,
  safeProviderDiagnostic,
  shape,
} from '../oxygen-manual-test/diagnostics';

export interface RegistrationDiagnostic {
  body: 'json' | 'empty' | 'invalid_json' | 'unreadable' | 'oversized';
  message?: string;
  error?: string;
  shape?: unknown;
  requestId?: string;
}

// Retain only redacted diagnostics. Unknown bodies and header values are never
// echoed; neither a 2xx nor a callback delivery alone proves registration.
export async function inspectRegistrationReceipt(
  response: Response,
  payload: { partner_reference: string; webhook_url: string },
  sensitiveValues: string[]
): Promise<{
  registration: 'confirmed' | 'unconfirmed';
  diagnostic: RegistrationDiagnostic;
}> {
  const diagnostic: RegistrationDiagnostic = { body: 'unreadable' };
  const requestId = response.headers.get('x-request-id');
  if (
    requestId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId
    ) &&
    !sensitiveValues.includes(requestId) &&
    requestId !== payload.partner_reference
  ) {
    diagnostic.requestId = requestId;
  }
  let data: unknown;
  try {
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 32768) {
          diagnostic.body = 'oversized';
          await reader.cancel();
          return { registration: 'unconfirmed', diagnostic };
        }
        chunks.push(next.value);
      }
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(combined);
    if (!text.trim()) diagnostic.body = 'empty';
    else {
      try {
        data = JSON.parse(text);
        diagnostic.body = 'json';
      } catch {
        diagnostic.body = 'invalid_json';
      }
    }
  } catch {
    diagnostic.body = 'unreadable';
  }
  if (diagnostic.body === 'json') {
    const fields = record(data);
    diagnostic.shape = shape(data);
    diagnostic.message = safeProviderDiagnostic(
      fields,
      payload,
      sensitiveValues
    );
    diagnostic.error = safeProviderDiagnostic(
      { message: fields.error },
      payload,
      sensitiveValues
    );
    if (
      response.ok &&
      typeof fields.id === 'number' &&
      Number.isSafeInteger(fields.id) &&
      fields.id > 0 &&
      fields.partnerReference === payload.partner_reference &&
      fields.webhookUrl === payload.webhook_url &&
      fields.active === true
    ) {
      return { registration: 'confirmed', diagnostic };
    }
  }
  return { registration: 'unconfirmed', diagnostic };
}
