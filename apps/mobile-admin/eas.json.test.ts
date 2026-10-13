import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const easConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'eas.json'), 'utf8')
) as {
  build: Record<string, { channel?: string }>;
};

describe('mobile-admin EAS Update channel policy', () => {
  it('isolates preview and production channels while leaving development on Metro', () => {
    expect(easConfig.build.preview.channel).toBe('preview');
    expect(easConfig.build.production.channel).toBe('production');
    expect(easConfig.build.development.channel).toBeUndefined();
  });

  it('does not embed EAS credentials in the build profile config', () => {
    const serialized = JSON.stringify(easConfig);

    expect(serialized).not.toMatch(
      /(?:EAS_TOKEN|EXPO_TOKEN|EXPO_ACCESS_TOKEN|eas[_-]?secret)/i
    );
  });
});
