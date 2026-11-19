import { after } from 'next/server';
import { purgeCloudflareHostnamesConfirmed } from '@/lib/cloudflare-purge';
import { resolvePurgeHostnames } from '@/lib/storefront-purge-shared';

/**
 * Awaited, confirmed hostname-wide Cloudflare purge for background workers that
 * must know whether edge eviction succeeded before advancing a sweep baseline.
 */
export async function purgeStorefrontHostnameConfirmed(
  identifier: string | null | undefined
): Promise<boolean> {
  try {
    const normalizedIdentifier = identifier?.trim();
    if (!normalizedIdentifier) {
      return true;
    }

    const hostnames = resolvePurgeHostnames(normalizedIdentifier);
    if (hostnames.length === 0) {
      return true;
    }

    const confirmation = await purgeCloudflareHostnamesConfirmed([
      ...hostnames,
    ]);
    return confirmation.ok === true;
  } catch (error) {
    console.warn('Confirmed Cloudflare storefront hostname purge failed', {
      identifier,
      error,
    });
    return false;
  }
}

/**
 * Bound an unusually broad storefront mutation to the configured public
 * hostnames. A hostname purge evicts every cached PDP without requiring an
 * unbounded per-product URL fan-out.
 */
export function scheduleStorefrontHostnamePurge(
  identifier: string | null | undefined
): void {
  try {
    const normalizedIdentifier = identifier?.trim();
    if (!normalizedIdentifier) {
      return;
    }

    const hostnames = resolvePurgeHostnames(normalizedIdentifier);
    if (hostnames.length === 0) {
      return;
    }

    const purge = async () => {
      await purgeCloudflareHostnamesConfirmed([...hostnames]);
    };
    try {
      after(purge);
    } catch {
      // Not inside a request scope (standalone worker / test) — detach instead.
      void purge();
    }
  } catch (error) {
    console.warn('Skipped Cloudflare storefront hostname purge scheduling', {
      identifier,
      error,
    });
  }
}
