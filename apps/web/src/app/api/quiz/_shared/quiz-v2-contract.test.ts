import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readQuizDeviceFingerprint,
  rejectUnsupportedQuizContract,
  requireQuizV2Contract,
  requireQuizV2Runtime,
  requiresQuizV2,
  resetQuizV2RuntimeCheckForTests,
} from './quiz-v2-contract';

function request(headers?: HeadersInit) {
  return new NextRequest('https://shop.test/api/quiz/events', { headers });
}

describe('quiz v2 route contract', () => {
  beforeEach(() => {
    resetQuizV2RuntimeCheckForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('distinguishes legacy, supported, and unsupported contracts', () => {
    expect(requiresQuizV2(request())).toBe(false);
    expect(requireQuizV2Contract(request())?.status).toBe(426);
    expect(rejectUnsupportedQuizContract(request())).toBeNull();

    const supported = request({ 'X-Baci-Quiz-Contract': '2' });
    expect(requiresQuizV2(supported)).toBe(true);
    expect(requireQuizV2Contract(supported)).toBeNull();

    expect(
      rejectUnsupportedQuizContract(request({ 'X-Baci-Quiz-Contract': '3' }))
        ?.status
    ).toBe(426);
  });

  it('fails closed until the database runtime sentinel is exactly 2', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    expect((await requireQuizV2Runtime({ rpc } as never))?.status).toBe(503);

    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await requireQuizV2Runtime({ rpc } as never)).toBeNull();
  });

  it('asks the database once, then reuses a pass for 15 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });

    expect(await requireQuizV2Runtime({ rpc } as never)).toBeNull();
    expect(await requireQuizV2Runtime({ rpc } as never)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-18T12:00:14Z'));
    expect(await requireQuizV2Runtime({ rpc } as never)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-18T12:00:16Z'));
    rpc.mockResolvedValue({ data: 1, error: null });
    expect((await requireQuizV2Runtime({ rpc } as never))?.status).toBe(503);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('never remembers a failed check', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'down' } })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ data: 2, error: null });

    expect((await requireQuizV2Runtime({ rpc } as never))?.status).toBe(503);
    expect((await requireQuizV2Runtime({ rpc } as never))?.status).toBe(503);
    expect(await requireQuizV2Runtime({ rpc } as never)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('shares one database call between requests that arrive together', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });

    const results = await Promise.all(
      Array.from({ length: 50 }, () => requireQuizV2Runtime({ rpc } as never))
    );

    expect(results.every((result) => result === null)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reads only a valid fingerprint header', () => {
    const fingerprint = 'a'.repeat(64);
    expect(
      readQuizDeviceFingerprint(
        request({ 'X-Baci-Quiz-Device-Fingerprint': fingerprint })
      )
    ).toBe(fingerprint);
    expect(readQuizDeviceFingerprint(request())).toBeNull();
    expect(
      readQuizDeviceFingerprint(
        request({ 'X-Baci-Quiz-Device-Fingerprint': 'not-a-hash' })
      )
    ).toBeNull();
  });
});
