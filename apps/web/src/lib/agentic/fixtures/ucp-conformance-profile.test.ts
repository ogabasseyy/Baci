// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from '../test-support/stub-agentic-env';
import { buildProfile } from './ucp-conformance-profile';

describe('UCP conformance profile', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a profile that declares the five shopping capabilities', async () => {
    const profile = await buildProfile();

    expect(
      Object.keys(profile.ucp.capabilities)
        .filter((name) => name.startsWith('dev.ucp.shopping.'))
        .sort()
    ).toEqual([
      'dev.ucp.shopping.cart',
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.catalog.search',
      'dev.ucp.shopping.checkout',
      'dev.ucp.shopping.order',
    ]);
  });

  it('returns the same inputs on every call', async () => {
    expect(await buildProfile()).toEqual(await buildProfile());
  });
});
