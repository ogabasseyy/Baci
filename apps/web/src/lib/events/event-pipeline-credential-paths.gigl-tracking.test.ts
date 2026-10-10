import { describe, expect, it } from 'vitest';
import { giglTrackingCredentialPaths } from './event-pipeline-credential-paths.gigl-tracking';

describe('gigl tracking credential paths', () => {
  it('roots every path at a gigl tracking module', () => {
    expect(giglTrackingCredentialPaths.length).toBeGreaterThan(0);
    expect(
      giglTrackingCredentialPaths.every(
        (path) =>
          path.length > 1 &&
          (path[0].includes('/gigl-tracking/') ||
            path[0].includes('/gigl-tracking-notifications/')) &&
          path.at(-1) === 'apps/web/src/env.ts'
      )
    ).toBe(true);
  });
});
