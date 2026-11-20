import { brilStashFeedDeploymentSchema } from '../../schemas/brilstash-feed-deployment';

export function resolveBrilStashFeedDeployment() {
  const parsed = brilStashFeedDeploymentSchema.safeParse({
    host: process.env.BRILSTASH_FEED_HOST,
    environment: process.env.BRILSTASH_FEED_ENV,
    projectRef: process.env.BRILSTASH_SUPABASE_PROJECT_REF,
  });
  if (!parsed.success) return null;
  const { host, environment, projectRef } = parsed.data;
  if (
    (environment === 'live' && process.env.VERCEL_ENV !== 'production') ||
    (environment === 'sandbox' && process.env.VERCEL_ENV === 'production')
  )
    return null;

  try {
    const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (database.href !== `https://${projectRef}.supabase.co/`) return null;
  } catch {
    return null;
  }
  return { host, singlePageOnly: environment === 'live' };
}
