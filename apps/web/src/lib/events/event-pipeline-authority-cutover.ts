/**
 * Source-controlled revocation switch for the temporary legacy analytics
 * authority. Environment variables alone must never activate queue-only mode.
 */
export const eventPipelineAuthorityCutover = {
  queueOnlyDeliveryActivated: false,
  temporaryAuthorityExpiresAt: '2026-09-30T00:00:00.000Z',
} as const;
