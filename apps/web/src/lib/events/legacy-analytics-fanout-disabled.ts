import { eventPipelineAuthorityCutover } from './event-pipeline-authority-cutover';

export function isLegacyAnalyticsFanoutDisabled(
  scope: 'merchant' | 'platform' = 'merchant'
): boolean {
  const authorityExpiry = Date.parse(
    scope === 'platform'
      ? eventPipelineAuthorityCutover.temporaryAuthorityExpiresAt
      : eventPipelineAuthorityCutover.merchantAuthorityExpiresAt
  );
  return (
    eventPipelineAuthorityCutover.queueOnlyDeliveryActivated ||
    !Number.isFinite(authorityExpiry) ||
    Date.now() >= authorityExpiry
  );
}
