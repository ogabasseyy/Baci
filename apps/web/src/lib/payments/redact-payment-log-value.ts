const REDACTED_PAYMENT_LOG_VALUE = '[REDACTED]';

const SENSITIVE_PAYMENT_LOG_KEYS = new Set([
  'address',
  'authorization',
  'authorization_header',
  'bank_account',
  'bank_verification_number',
  'national_identification_number',
  'identity_number',
  'identification_number',
  'birth_date',
  'session',
  'session_id',
  'sessionid',
  'proxy_authorization',
  'cookie',
  'set_cookie',
  'bvn',
  'nin',
  'pan',
  'cvv',
  'cvc',
  'pin',
  'otp',
  'password',
  'passcode',
  'credential',
  'credentials',
  'secret',
  'signature',
  'date_of_birth',
  'dob',
  'national_id',
  'account_number',
  'card_number',
  'api_key',
  'private_key',
  'public_key',
  'billing_address',
  'city',
  'customer_email',
  'customer_name',
  'customer_phone',
  'email',
  'first_name',
  'formatted_phone',
  'last_name',
  'line1',
  'line2',
  'mobile_number',
  'name',
  'original_phone',
  'phone',
  'phone_number',
  'postal_code',
  'state',
  'tracking_token',
  'zip_code',
]);

function normalizePaymentLogKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function shouldRedactPaymentLogKey(key: string): boolean {
  const normalizedKey = normalizePaymentLogKey(key);
  const compactKey = normalizedKey.replaceAll('_', '');
  return (
    SENSITIVE_PAYMENT_LOG_KEYS.has(normalizedKey) ||
    /(?:token|secret|password|passcode|credential|signature|apikey|privatekey|publickey|accountnumber|accountno|cardnumber|dateofbirth|birthdate|nationalid|bvn|bvnnumber|nin|ninnumber|cvv|cvc|otp|pin)(?:value|code|confirmation)?$/.test(
      compactKey
    ) ||
    normalizedKey.endsWith('_email') ||
    normalizedKey.endsWith('_phone') ||
    normalizedKey.endsWith('_phone_number')
  );
}

function redactPaymentLogRecord(
  record: Record<string, unknown>,
  seen: WeakSet<object>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      shouldRedactPaymentLogKey(key)
        ? REDACTED_PAYMENT_LOG_VALUE
        : redactPaymentLogValueInternal(value, seen),
    ])
  );
}

function redactPaymentLogValueInternal(
  value: unknown,
  seen: WeakSet<object>
): unknown {
  if (!(value && typeof value === 'object')) {
    return value;
  }

  if (seen.has(value)) {
    return { circular: true };
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactPaymentLogValueInternal(item, seen));
    }

    return redactPaymentLogRecord(value as Record<string, unknown>, seen);
  } finally {
    seen.delete(value);
  }
}

export function redactPaymentLogValue(value: unknown): unknown {
  return redactPaymentLogValueInternal(value, new WeakSet<object>());
}
