/**
 * Busts the feed cache via the revalidation endpoint so the next feed
 * request picks up the fresh manifest immediately. Requires CRON_SECRET
 * to match the deployed app's value; skips silently otherwise.
 */
export async function revalidateFeedCache(args: {
  storefrontBaseUrl: string;
  merchantId: string;
}): Promise<void> {
  const { storefrontBaseUrl, merchantId } = args;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('\nCRON_SECRET not set — skipping feed cache revalidation.');
    console.warn('Feed cache may be stale for up to 1 hour.');
    return;
  }

  console.log('\nRevalidating feed cache...');
  try {
    const revalidateUrl = `${storefrontBaseUrl}/api/feed/google-merchant/revalidate`;
    const res = await fetch(revalidateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ merchant_id: merchantId }),
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
