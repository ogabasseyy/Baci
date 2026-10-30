import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/webhook-secret-union', () => ({
  verifyPiggyvestWebhookSecrets: (...args: unknown[]) => mocks.verify(...args),
}));
vi.mock('@/lib/piggyvest/webhook-capture', () => ({
  captureVerifiedDelivery: (...args: unknown[]) => mocks.capture(...args),
}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { admitPiggyvestDelivery } from './ingress';

const signature = randomBytes(64).toString('hex');
const rawBody = Buffer.from(' {"eventId":"evt-1"}\n');
const client = {} as PiggyvestIntakeServiceClient;
const receipt = {
  outcome: 'captured',
  id: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
  processingState: 'pending',
};

function admit(headers: Record<string, string>, createClient = () => client) {
  return admitPiggyvestDelivery({
    request: { headers: new Headers(headers) },
    rawBody,
    createClient,
  });
}

let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capture.mockResolvedValue(receipt);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  warns.mockRestore();
});

async function rejected(result: Awaited<ReturnType<typeof admit>>) {
  if (result.kind !== 'rejected') throw new Error('expected a rejection');
  return {
    status: result.response.status,
    body: await result.response.json(),
    cache: result.response.headers.get('Cache-Control'),
  };
}

describe('admitPiggyvestDelivery', () => {
  it('answers 503 and alerts, without touching storage, when no key is configured', async () => {
    mocks.verify.mockReturnValue({ status: 'unconfigured' });
    const createClient = vi.fn(() => client);

    const outcome = await rejected(await admit({}, createClient));

    expect(outcome).toEqual({
      status: 503,
      body: { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
      cache: 'no-store',
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED')
    );
  });

  it('answers 401 for an invalid signature, noting only whether a header was present', async () => {
    mocks.verify.mockReturnValue({ status: 'invalid' });

    const present = await rejected(
      await admit({ 'x-pvb-signature': signature })
    );
    const absent = await rejected(await admit({}));

    expect(present.status).toBe(401);
    expect(present.body).toEqual({
      received: false,
      code: 'PIGGYVEST_INVALID_SIGNATURE',
    });
    expect(absent.status).toBe(401);
    expect(warns).toHaveBeenCalledWith(
      expect.stringContaining('(signature header present)')
    );
    expect(warns).toHaveBeenCalledWith(
      expect.stringContaining('(signature header absent)')
    );
    expect(JSON.stringify(warns.mock.calls)).not.toContain(signature);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('answers a revoked key exactly like an invalid one but alerts with its version', async () => {
    mocks.verify.mockReturnValue({
      status: 'revoked',
      keyVersion: 'pv-2026-09',
    });

    const outcome = await rejected(
      await admit({ 'x-pvb-signature': signature })
    );

    expect(outcome.status).toBe(401);
    expect(outcome.body).toEqual({
      received: false,
      code: 'PIGGYVEST_INVALID_SIGNATURE',
    });
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(
        'PIGGYVEST_WEBHOOK_KEY_REVOKED {"keyVersion":"pv-2026-09"'
      )
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('captures a verified delivery with the canonical signature and key evidence', async () => {
    mocks.verify.mockReturnValue({
      status: 'verified',
      secret: 'matched-secret',
      families: ['legacy', 'interest'],
      keyVersion: 'pv-2026-10',
      keyStatus: 'overlap',
    });
    const headers = {
      'x-pvb-signature': ` ${signature.toUpperCase()} `,
      'content-type': 'application/json',
    };

    const result = await admit(headers);

    expect(result).toEqual({
      kind: 'admitted',
      delivery: {
        matchedSecret: 'matched-secret',
        families: ['legacy', 'interest'],
        signature,
        capture: receipt,
      },
    });
    expect(mocks.capture).toHaveBeenCalledWith(client, {
      rawBody,
      headers: expect.any(Headers),
      signature,
      keyVersion: 'pv-2026-10',
      keyFamilies: ['legacy', 'interest'],
      keyStatus: 'overlap',
    });
  });

  it('derives a non-secret key version and defaults to current when the verifier gives none', async () => {
    mocks.verify.mockReturnValue({
      status: 'verified',
      secret: 'matched-secret',
      families: ['legacy'],
    });

    await admit({ 'x-pvb-signature': signature });

    const sent = mocks.capture.mock.calls[0]?.[1];
    expect(sent.keyStatus).toBe('current');
    expect(sent.keyVersion).toMatch(/^k-[0-9a-f]{16}$/);
    expect(sent.keyVersion).not.toContain('matched-secret');
  });

  it('fails closed when a verified delivery carries no reproducible signature', async () => {
    mocks.verify.mockReturnValue({
      status: 'verified',
      secret: 'matched-secret',
      families: ['legacy'],
    });

    const outcome = await rejected(await admit({}));

    expect(outcome.status).toBe(401);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the write fails',
      () => mocks.capture.mockRejectedValue(new Error('10.0.0.5 refused')),
    ],
    ['the client cannot be created', () => undefined],
  ])('answers 503 with an alert and no internals when %s', async (name, arrange) => {
    mocks.verify.mockReturnValue({
      status: 'verified',
      secret: 'matched-secret',
      families: ['legacy'],
    });
    arrange();
    const createClient =
      name === 'the client cannot be created'
        ? () => {
            throw new Error('missing service credentials');
          }
        : () => client;

    const outcome = await rejected(
      await admit({ 'x-pvb-signature': signature }, createClient)
    );

    expect(outcome).toEqual({
      status: 503,
      body: {
        error: 'Event intake unavailable',
        code: 'PIGGYVEST_CAPTURE_UNAVAILABLE',
      },
      cache: 'no-store',
    });
    expect(JSON.stringify(outcome.body)).not.toMatch(/10\.0\.0\.5|credentials/);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_CAPTURE_FAILED')
    );
  });
});
