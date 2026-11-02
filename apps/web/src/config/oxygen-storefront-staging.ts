/** Local storefront QA only. This is not a production provider rollout flag. */
export function isOxygenStorefrontStagingEnabled(): boolean {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT !== 'true'
  )
    return false;
  try {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    return (
      backend.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(backend.hostname)
    );
  } catch {
    return false;
  }
}
