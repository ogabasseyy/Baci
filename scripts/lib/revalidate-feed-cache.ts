/**
 * Busts the feed cache via the revalidation endpoint so the next feed
 * request picks up the fresh manifest immediately. Requires CRON_SECRET
 * to match the deployed app's value.
 *
 * The request must go to the deployment-controlled application origin,
 * never a merchant storefront domain: a merchant who repoints their
 * domain's DNS before this backfill runs would otherwise receive the
 * global CRON_SECRET bearer credential.
 */
export async function revalidateFeedCache(args: {
  merchantId: string;
}): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(
    /\/+$/,
    ''
  );
  const missing = [
    !cronSecret && 'CRON_SECRET',
    !appBaseUrl && 'NEXT_PUBLIC_APP_URL',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.warn(
      `\n${missing.join(' and ')} not set — skipping feed cache revalidation.`
    );
    console.warn('Feed cache may be stale for up to 1 hour.');
    return;
  }

  console.log('\nRevalidating feed cache...');
  try {
    const revalidateUrl = `${appBaseUrl}/api/feed/google-merchant/revalidate`;
    const res = await fetch(revalidateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ merchant_id: args.merchantId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      console.log('  Feed cache revalidated successfully.');
    } else {
      console.warn(`  Revalidation returned ${res.status} — cache may be stale for up to 1 hour.`);
    }
  } catch (err) {
    console.warn(`  Could not reach revalidation endpoint: ${(err as Error).message}`);
    console.warn('  Feed cache may be stale for up to 1 hour.');
  }
}
