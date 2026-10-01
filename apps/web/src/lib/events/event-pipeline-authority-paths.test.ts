import { describe, expect, it } from 'vitest';
import { eventPipelineAdminImporters } from './event-pipeline-authority-paths';
import { eventPipelineLegacySdkImporters } from './event-pipeline-legacy-sdk-importers';

describe('event-pipeline authority paths', () => {
  it('keeps the privileged importer allowlist explicit', () => {
    expect(eventPipelineAdminImporters).not.toContain(
      'apps/web/src/app/api/platform/events/platform-event-forwarding.ts'
    );
    expect(eventPipelineAdminImporters).toContain(
      'apps/web/src/lib/expo-push.ts'
    );
    for (const importer of eventPipelineLegacySdkImporters) {
      expect(eventPipelineAdminImporters).not.toContain(importer);
    }
  });
});
