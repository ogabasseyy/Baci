/** The Santa campaign runs in December, store time (Africa/Lagos). */
const SANTA_TIME_ZONE = 'Africa/Lagos';

export function isDecemberInLagos(now: Date): boolean {
  const month = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTA_TIME_ZONE,
    month: 'numeric',
  }).format(now);
  return month === '12';
}

/**
 * Santa mode is on only when the flag is exactly 'true', it is December in
 * Lagos, and the chat's store is the one the Santa catalog is configured for.
 * Anything else keeps the assistant exactly as it is.
 */
export function isSantaModeActive(input: {
  merchantId: string;
  santaTenantMerchantId: string | undefined;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): boolean {
  const env = input.env ?? process.env;
  if (env.EKAETTE_CHATWOOT_SANTA_ENABLED !== 'true') return false;
  if (!isDecemberInLagos(input.now ?? new Date())) return false;
  return (
    input.santaTenantMerchantId !== undefined &&
    input.santaTenantMerchantId === input.merchantId
  );
}
