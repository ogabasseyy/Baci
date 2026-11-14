import { describe, expect, it, vi } from 'vitest';

const getExpoAccessToken = vi.hoisted(() => vi.fn(() => 'token'));
vi.mock('@/env', () => ({ getExpoAccessToken }));

import { getExpoClient } from './expo-client';

describe('getExpoClient', () => {
  it('builds one Expo client lazily from the configured access token', () => {
    expect(getExpoAccessToken).not.toHaveBeenCalled();

    const first = getExpoClient();

    expect(getExpoClient()).toBe(first);
    expect(getExpoAccessToken).toHaveBeenCalledTimes(1);
  });
});
