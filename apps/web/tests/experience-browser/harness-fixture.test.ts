import { describe, expect, it } from 'vitest';
import { parseExperienceManifest } from '../../src/schemas/experience-manifest';
import { wrappedFixture } from './harness-fixture';

describe('wrapped qualification source', () => {
  it('preserves arbitrary source and adds only a synthetic provider/port entry', () => {
    const manifest = wrappedFixture('device-configurator');
    expect(parseExperienceManifest(manifest)).toEqual(manifest);
    expect(manifest.files[0].content).toContain('useEffect');
    expect(
      manifest.files.find((f) => f.path === manifest.entry)?.content
    ).toContain('event.source!==parent');
  });
});
