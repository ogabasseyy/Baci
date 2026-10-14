import { logger } from '@/lib/logger';

const KUDA_RAW_DEBUG_SERVICE_TYPES = new Set([
  'ADMIN_PURCHASE_BILL',
  'BILL_TSQ',
]);

const KUDA_RAW_DEBUG_REDACT_KEYS = new Set([
  'apikey',
  'authorization',
  'billtoken',
  'customerfirstname',
  'customeridentifier',
  'email',
  'metertoken',
  'phone',
  'phonenumber',
  'pin',
  'token',
  'vendcode',
  'voucher',
  'vouchercode',
  'voucherpin',
]);

function normalizeKudaDebugKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function readKudaBillDebugFlag(): string {
  // Browser runtimes never enable bill debug (mirrors
  // getKudaBillDebug; server-route tests run in jsdom, so
  // NODE_ENV=test counts as server, matching isBrowserRuntime).
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    return '';
  }
  // Read directly instead of via @/env: env.ts is the credential
  // authority (service-role key), and routing this debug flag
  // through it drags every Kuda consumer into its import graph,
  // tripping the event-pipeline boundary contract for any new file
  // touching Kuda. getEnv() derives KUDA_BILL_DEBUG from this same
  // variable, so the validated-env fallback adds nothing.
  return (process.env.KUDA_BILL_DEBUG ?? '').trim();
}

export function isKudaBillDebugEnabled() {
  const value = readKudaBillDebugFlag().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function getDebugValueShape(value: unknown) {
  if (Array.isArray(value)) {
    return {
      redacted: true,
      type: 'array',
      length: value.length,
    };
  }

  if (value && typeof value === 'object') {
    return {
      redacted: true,
      type: 'object',
      keys: Object.keys(value as Record<string, unknown>).slice(0, 25),
    };
  }

  return {
    redacted: true,
    type: value === null ? 'null' : typeof value,
    length: typeof value === 'string' ? value.length : undefined,
  };
}

function shouldRedactKudaDebugValue(key: string, value: unknown) {
  if (KUDA_RAW_DEBUG_REDACT_KEYS.has(normalizeKudaDebugKey(key))) {
    return true;
  }

  return typeof value === 'string' && /^\+?\d[\d\s-]{7,}$/.test(value.trim());
}

function sanitizeKudaDebugPrimitive(value: unknown) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.description ? `[Symbol:${value.description}]` : '[Symbol]';
  }

  return value;
}

export function redactKudaDebugPayload(value: unknown, depth = 0): unknown {
  return redactKudaDebugValue(value, depth, new WeakSet<object>());
}

function redactKudaDebugValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (depth > 7) {
    return '[MAX_DEPTH]';
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const redacted = value.map((item) =>
      redactKudaDebugValue(item, depth + 1, seen)
    );
    seen.delete(value);
    return redacted;
  }

  if (!value || typeof value !== 'object') {
    return sanitizeKudaDebugPrimitive(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  const redacted = Object.entries(value as Record<string, unknown>).reduce<
    Record<string, unknown>
  >((payload, [key, nestedValue]) => {
    payload[key] = shouldRedactKudaDebugValue(key, nestedValue)
      ? getDebugValueShape(nestedValue)
      : redactKudaDebugValue(nestedValue, depth + 1, seen);
    return payload;
  }, {});
  seen.delete(value);
  return redacted;
}

export function safeSerialize(value: unknown) {
  const ancestors: object[] = [];

  try {
    return JSON.stringify(value, function (this: unknown, _key, nestedValue) {
      if (typeof nestedValue === 'bigint' || typeof nestedValue === 'symbol') {
        return sanitizeKudaDebugPrimitive(nestedValue);
      }

      if (nestedValue && typeof nestedValue === 'object') {
        while (
          ancestors.length > 0 &&
          ancestors[ancestors.length - 1] !== this
        ) {
          ancestors.pop();
        }

        if (ancestors.includes(nestedValue)) {
          return '[Circular]';
        }
        ancestors.push(nestedValue);
      }

      return nestedValue;
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      serializationFailed: true,
    });
  }
}

export function logKudaRawResponse({
  raw,
  requestData,
  requestRef,
  serviceType,
}: {
  raw: unknown;
  requestData: Record<string, unknown>;
  requestRef: string;
  serviceType: string;
}) {
  if (
    !isKudaBillDebugEnabled() ||
    !KUDA_RAW_DEBUG_SERVICE_TYPES.has(serviceType)
  ) {
    return;
  }

  const redactedRequestData = redactKudaDebugPayload(requestData);
  const redactedRawResponse = redactKudaDebugPayload(raw);

  logger.info({
    message: 'Kuda raw response received',
    requestData: redactedRequestData,
    requestDataJson: safeSerialize(redactedRequestData),
    requestRef,
    rawResponse: redactedRawResponse,
    rawResponseJson: safeSerialize(redactedRawResponse),
    serviceType,
  });
}
