// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

describe('reloadChatwootTenantDocument (browser fixture)', () => {
  it('reloads immediately when the configured reset delay is zero', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });
    vi.stubGlobal('__CHATWOOT_FIXTURE_RESET_DELAY_MS__', 0);
    const { reloadChatwootTenantDocument } = await import(
      './reload-tenant-document'
    );

    reloadChatwootTenantDocument();

    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('defers reload by the configured reset delay when positive', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });
    vi.stubGlobal('__CHATWOOT_FIXTURE_RESET_DELAY_MS__', 300);
    const { reloadChatwootTenantDocument } = await import(
      './reload-tenant-document'
    );

    reloadChatwootTenantDocument();
    expect(reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(reload).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
