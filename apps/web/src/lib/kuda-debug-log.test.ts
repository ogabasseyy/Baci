import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
}));

describe('kuda-debug-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('detects enabled Kuda bill debug flags', async () => {
    let { isKudaBillDebugEnabled } = await import('@/lib/kuda-debug-log');

    expect(isKudaBillDebugEnabled()).toBe(false);

    vi.stubEnv('KUDA_BILL_DEBUG', 'yes');
    vi.resetModules();
    ({ isKudaBillDebugEnabled } = await import('@/lib/kuda-debug-log'));

    expect(isKudaBillDebugEnabled()).toBe(true);
  });

  it('logs fixed metadata only, never request or response payloads', async () => {
    // Codex R98 P1: redacting selected keys did not satisfy the VTU
    // exception's absolute prohibition on provider response bodies
    // entering logs — the marker carries routing metadata only.
    vi.stubEnv('KUDA_BILL_DEBUG', '1');
    const { logKudaResponse } = await import('@/lib/kuda-debug-log');

    logKudaResponse({ requestRef: 'REQ-123', serviceType: 'BILL_TSQ' });
    logKudaResponse({ requestRef: 'REQ-456', serviceType: 'GET_BILLERS' });

    expect(loggerMocks.info).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith({
      message: 'Kuda response received',
      requestRef: 'REQ-123',
      serviceType: 'BILL_TSQ',
    });
  });

  it('does not log when debug is disabled', async () => {
    vi.stubEnv('KUDA_BILL_DEBUG', '0');
    const { logKudaResponse } = await import('@/lib/kuda-debug-log');

    logKudaResponse({ requestRef: 'REQ-123', serviceType: 'BILL_TSQ' });

    expect(loggerMocks.info).not.toHaveBeenCalled();
  });
});
