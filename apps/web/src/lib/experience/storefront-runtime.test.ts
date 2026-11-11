// @vitest-environment node
import { expect, it } from 'vitest';
import {
  getExperienceStorefrontRuntime,
  installExperienceStorefrontRuntime,
} from './storefront-runtime';

it('requires explicit installation, refuses replacement, and removes only its own installation', () => {
  expect(getExperienceStorefrontRuntime()).toBeNull();
  const runtime = {
    loadPublishedManifest: async () => null,
    resolveBoundary: async () => null,
    catalog: async () => null,
    state: async () => ({
      active: false,
      policyRevision: '',
      catalogRevision: '',
    }),
  };
  const remove = installExperienceStorefrontRuntime(runtime);
  try {
    expect(getExperienceStorefrontRuntime()).toBe(runtime);
    expect(() => installExperienceStorefrontRuntime(runtime)).toThrow(
      'ALREADY_INSTALLED'
    );
  } finally {
    remove();
  }
  expect(getExperienceStorefrontRuntime()).toBeNull();
});
