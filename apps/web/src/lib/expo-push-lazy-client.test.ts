import { describe, expect, it, vi } from 'vitest';
import { createLazyExpoGetter } from './expo-push-lazy-client';

describe('createLazyExpoGetter', () => {
  it('reads the access token once and caches the client', () => {
    const getToken = vi.fn(() => 'tok');
    const getExpo = createLazyExpoGetter(getToken);

    expect(getExpo()).toBe(getExpo());
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('warns when no access token is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createLazyExpoGetter(() => undefined)();

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
