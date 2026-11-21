import './test-env.test-setup.mjs';
import { describe, expect, it, vi } from 'vitest';
import { platformOrigin } from './config.mjs';

vi.mock('./cookie-diagnostics.mjs', () => ({
  readChatwootCookieMetadata: vi.fn(async () => ({ present: false })),
}));

describe('scenario-tenant-b', () => {
  it('verifies tenant A session stays deferred during checkout and clears before tenant B', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const widgetFrame = {
      url: () => `${platformOrigin}/widget`,
      getByRole: vi.fn(() => ({
        waitFor: vi.fn().mockResolvedValue(undefined),
      })),
      getByText: vi.fn(() => ({ count: vi.fn(async () => 0) })),
    };
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('/synthetic-tenant-b/checkout')
      .mockResolvedValueOnce({
        documentStart: {
          conversationCookieMatchesPreviousInbox: false,
          chatwootCookieCount: 0,
        },
        resetEvidence: {
          beforeMatchesTenantA: true,
          afterMatchesTenantA: false,
        },
        previousInbox: '42',
        currentInbox: '99',
        bridgeTenant: 'synthetic-tenant-b',
      })
      .mockResolvedValueOnce({ blocked: true })
      .mockResolvedValueOnce(undefined);
    const page = {
      getByRole: vi.fn(() => ({ click: vi.fn().mockResolvedValue(undefined) })),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      evaluate,
      frames: vi.fn(() => [widgetFrame]),
    };
    const state = {
      phase: 'setup',
      page,
      blockedOrigins: new Set(),
    };

    const { runTenantB } = await import('./scenario-tenant-b.mjs');
    const context = { close: vi.fn().mockResolvedValue(undefined) };
    await runTenantB(state, context, {
      tenantAClaims: { inbox_id: 42 },
      syntheticAMessage: 'BACI-SYNTHETIC-MSG-1',
    });

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(state.tenantBResult?.bridgeTenant).toBe('synthetic-tenant-b');
    logSpy.mockRestore();
  });
});
