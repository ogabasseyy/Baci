/**
 * Source-controlled revocation switch for the temporary legacy analytics
 * authority. Environment variables alone must never activate queue-only mode.
 */
export const eventPipelineAuthorityCutover = {
  queueOnlyDeliveryActivated: false,
  merchantAuthorityExpiresAt: '2026-09-16T00:00:00.000Z',
  // Only the platform edge was renewed; this is not merchant authorization.
  temporaryAuthorityExpiresAt: '2026-09-30T00:00:00.000Z',
} as const;
