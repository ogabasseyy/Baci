// @vitest-environment-options {"url":"https://shop.example.com"}
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { containPreviousChatwootTenant } from './contain-chatwoot-previous-tenant';

type W = Parameters<typeof containPreviousChatwootTenant>[0];

function widgetWindow(overrides: Partial<W> = {}): W {
  return Object.assign(window, {
    __baciChatwootConfigKey: 'tenant-a',
    __baciChatwootReadyKey: undefined,
    __baciChatwootContainedKey: undefined,
    __baciChatwootPendingContainKey: undefined,
    $chatwoot: undefined,
    ...overrides,
  }) as W;
}

beforeEach(() => {
  widgetWindow();
});

describe('containPreviousChatwootTenant', () => {
  it('resets and hides a ready widget once per tenant key', () => {
    const reset = vi.fn();
    const toggle = vi.fn();
    const w = widgetWindow({
      __baciChatwootReadyKey: 'tenant-a',
      $chatwoot: { reset, toggleBubbleVisibility: toggle },
    });

    containPreviousChatwootTenant(w);
    containPreviousChatwootTenant(w);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith('hide');
    expect(w.__baciChatwootContainedKey).toBe('tenant-a');
  });

  it('retries on the next call when reset throws and still hides', () => {
    const reset = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('reset failed');
      })
      .mockImplementation(() => undefined);
    const toggle = vi.fn();
    const w = widgetWindow({
      __baciChatwootReadyKey: 'tenant-a',
      $chatwoot: { reset, toggleBubbleVisibility: toggle },
    });

    expect(() => containPreviousChatwootTenant(w)).not.toThrow();
    expect(w.__baciChatwootContainedKey).toBeUndefined();
    expect(toggle).toHaveBeenCalledWith('hide');

    containPreviousChatwootTenant(w);
    expect(reset).toHaveBeenCalledTimes(2);
    expect(w.__baciChatwootContainedKey).toBe('tenant-a');
  });

  it('does not reset a pending widget, and contains it when it becomes ready', () => {
    const reset = vi.fn();
    const w = widgetWindow({
      $chatwoot: {
        reset,
        toggleBubbleVisibility: () => {
          throw new TypeError('bubble holder missing');
        },
      },
    });

    expect(() => containPreviousChatwootTenant(w)).not.toThrow();
    expect(reset).not.toHaveBeenCalled();
    expect(w.__baciChatwootPendingContainKey).toBe('tenant-a');

    window.dispatchEvent(new Event('chatwoot:ready'));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(w.__baciChatwootContainedKey).toBe('tenant-a');
  });

  it('cancels pending containment when the tenant becomes current again', () => {
    const reset = vi.fn();
    const w = widgetWindow({
      $chatwoot: { reset, toggleBubbleVisibility: vi.fn() },
    });

    containPreviousChatwootTenant(w);
    w.__baciChatwootPendingContainKey = undefined; // set by the lifecycle hook on return

    window.dispatchEvent(new Event('chatwoot:ready'));
    expect(reset).not.toHaveBeenCalled();
  });
});
