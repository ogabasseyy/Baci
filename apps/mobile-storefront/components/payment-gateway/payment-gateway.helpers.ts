const PAYMENT_GATEWAYS = ['paystack', 'korapay', 'juicyway'] as const;

export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export const PAYMENT_GATEWAY_LABELS = {
  paystack: 'Paystack',
  korapay: 'Korapay',
  juicyway: 'Juicyway',
} satisfies Record<PaymentGateway, string>;

export const isPaymentGateway = (value: unknown): value is PaymentGateway =>
  typeof value === 'string' &&
  PAYMENT_GATEWAYS.includes(value as PaymentGateway);

export const PAYMENT_KINDS = {
  ORDER: 'order',
  SAVINGS_AUTH: 'savings_auth',
  VTU: 'vtu',
  WALLET: 'wallet',
} as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[keyof typeof PAYMENT_KINDS];

export const isPlainRecord = (
  value: unknown
): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const isPaymentCompletionRedirect = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.pathname.endsWith('/checkout/success') ||
      parsedUrl.pathname.endsWith('/order-success') ||
      parsedUrl.searchParams.has('trxref')
    );
  } catch {
    return false;
  }
};

/**
 * Extracts the provider payment reference (Paystack `trxref`, or a plain
 * `reference` param) from a navigated URL, if present.
 */
export const getPaymentRedirectReference = (
  url: string
): string | undefined => {
  try {
    const parsedUrl = new URL(url);
    for (const key of ['trxref', 'reference']) {
      const value = parsedUrl.searchParams.get(key)?.trim();
      if (value) return value;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether a completion-redirect URL belongs to this checkout session: a
 * redirect carrying a provider reference must carry OURS — otherwise it is
 * an unrelated navigation (or replayed callback) that must not complete.
 */
export const isSessionPaymentCompletionRedirect = (
  url: string,
  sessionReference?: string
): boolean => {
  if (!isPaymentCompletionRedirect(url)) return false;
  const redirectReference = getPaymentRedirectReference(url);
  if (
    redirectReference &&
    sessionReference &&
    redirectReference !== sessionReference.trim()
  ) {
    return false;
  }
  return true;
};

export const isPaymentCancellationRedirect = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.searchParams.get('cancelled') === 'true' ||
      parsedUrl.searchParams.get('cancel') === 'true' ||
      parsedUrl.pathname.split('/').includes('cancel')
    );
  } catch {
    return false;
  }
};
