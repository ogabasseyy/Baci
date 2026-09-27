import { describe, expect, it } from 'vitest';
import { eventPipelineAuthorityCutover } from './event-pipeline-authority-cutover';

describe('eventPipelineAuthorityCutover', () => {
  it('keeps queue-only delivery disabled until a reviewed source change', () => {
    expect(eventPipelineAuthorityCutover.queueOnlyDeliveryActivated).toBe(
      false
    );
    expect(eventPipelineAuthorityCutover.temporaryAuthorityExpiresAt).toBe(
      '2026-09-30T00:00:00.000Z'
    );
  });
});
