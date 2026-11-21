import type { OxygenMobileCapabilities } from '@baci/shared/oxygen';
export type OxygenHostedKind = 'selfie' | 'payment';
type HostedOrigins = Pick<
  OxygenMobileCapabilities,
  'hostedOrigins' | 'selfieOrigins'
>;
// The caller supplies the exact URL from its owned workflow response. The
// provider controls the path and query, so validate the configured origin here.
export function canOpenOxygenHostedUrl(
  url: string,
  kind: OxygenHostedKind,
  capabilities: HostedOrigins
): boolean {
  try {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      Array.from(url).some(
        (character) => character.charCodeAt(0) <= 32 || character === '\\'
      )
    )
      return false;
    const origins =
      kind === 'selfie'
        ? capabilities.selfieOrigins
        : capabilities.hostedOrigins;
    return Array.isArray(origins) && origins.includes(target.origin);
  } catch {
    return false;
  }
}
/** Event text is deliberately absent: every event can only request a bounded authoritative read. */
export function createOxygenStatusRefresher(
  refreshStatus: () => Promise<unknown>,
  maxAttempts = 8
) {
  let attempts = 0;
  let busy = false;
  let stopped = false;
  return {
    isPaused() {
      return stopped || attempts >= maxAttempts;
    },
    async refresh() {
      if (stopped || busy || attempts >= maxAttempts) return;
      busy = true;
      attempts++;
      try {
        await refreshStatus();
      } catch (error) {
        stopped = true;
        throw error;
      } finally {
        busy = false;
      }
    },
    stop() {
      stopped = true;
    },
    start() {
      stopped = false;
      attempts = 0;
    },
  };
}
