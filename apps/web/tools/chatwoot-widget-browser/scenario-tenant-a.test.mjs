import './test-env.test-setup.mjs';
import { describe, expect, it, vi } from 'vitest';
import { platformOrigin } from './config.mjs';

const mockSendSyntheticMessage = vi.fn(async () => 'BACI-SYNTHETIC-MSG-1');

vi.mock('./send-synthetic-message.mjs', () => ({
  sendSyntheticMessage: (...args) => mockSendSyntheticMessage(...args),
}));

vi.mock('./cookie-diagnostics.mjs', () => ({
  readChatwootCookieMetadata: vi.fn(async () => ({ present: true })),
}));

describe('scenario-tenant-a', () => {
  it('loads tenant A, sends a synthetic message, and captures cookie metadata', async () => {
    const widgetFrame = {
      url: () => `${platformOrigin}/widget`,
      getByRole: vi.fn(() => ({ click: vi.fn().mockResolvedValue(undefined) })),
    };
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce({ inbox_id: 42 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ inbox_id: 42 })
      .mockResolvedValueOnce(undefined);
    const state = {
      phase: 'setup',
      page: {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        frames: vi.fn(() => [widgetFrame]),
      },
    };

    const { runTenantA } = await import('./scenario-tenant-a.mjs');
    const result = await runTenantA(state, {});

    expect(state.tenantAInboxId).toBe(42);
    expect(result.syntheticAMessage).toBe('BACI-SYNTHETIC-MSG-1');
    expect(mockSendSyntheticMessage).toHaveBeenCalledTimes(1);
  });
});
