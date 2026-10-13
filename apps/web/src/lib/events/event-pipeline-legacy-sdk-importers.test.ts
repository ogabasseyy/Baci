import { describe, expect, it } from 'vitest';
import { eventPipelineLegacySdkImporters } from './event-pipeline-legacy-sdk-importers';

describe('event-pipeline legacy SDK paths', () => {
  it('keeps legacy SDK importers separate from privileged importers', () => {
    expect(eventPipelineLegacySdkImporters).toContain(
      'apps/web/src/lib/events/event-pipeline-test-client.ts'
    );
    expect(eventPipelineLegacySdkImporters).not.toContain(
      'apps/web/src/lib/expo-push.ts'
    );
  });
});
