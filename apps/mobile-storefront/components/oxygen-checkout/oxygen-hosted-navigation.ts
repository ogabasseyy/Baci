import type { OxygenMobileCapabilities } from '@baci/shared/oxygen';
export type OxygenHostedKind = 'selfie' | 'payment';
type HostedOrigins = Pick<
  OxygenMobileCapabilities,
  'hostedOrigins' | 'selfieOrigins'
>;
export function decideOxygenHostedNavigation(
  url: string,
  kind: OxygenHostedKind,
  capabilities: HostedOrigins,
  popup = false
): 'allow' | 'block' | 'external' {
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
      return 'block';
    const origins =
      kind === 'selfie'
        ? capabilities.selfieOrigins
        : capabilities.hostedOrigins;
    if (!origins.includes(target.origin)) return 'block';
    return popup ? (kind === 'payment' ? 'external' : 'block') : 'allow';
  } catch {
    return 'block';
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
    },
  };
}
