import { createHash } from 'node:crypto';
import { vi } from 'vitest';

type CaptureHarness = {
  secret: string;
  records: Map<
    string,
    { rawHex: string; signature: string; digest: string; state: string }
  >;
  dispatch: ReturnType<typeof vi.fn>;
  finishFailure: boolean;
  enqueueFailure: boolean;
  claims: number;
  creditCount: number;
  notificationCount: number;
  handedOff: Array<{ bytes: Buffer; signature: string | null }>;
  logger: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
};

const harness = vi.hoisted(() => {
  const state: CaptureHarness = {
    secret: globalThis.crypto.randomUUID(),
    records: new Map(),
    dispatch: vi.fn(),
    finishFailure: false,
    enqueueFailure: false,
    claims: 0,
    creditCount: 0,
    notificationCount: 0,
    handedOff: [],
    logger: vi.fn<(...args: unknown[]) => void>(),
  };
  (
    globalThis as typeof globalThis & {
      __baciInterestCaptureHarness?: CaptureHarness;
    }
  ).__baciInterestCaptureHarness = state;
  return state;
});

export function getCaptureHarness(): CaptureHarness {
  const state = (
    globalThis as typeof globalThis & {
      __baciInterestCaptureHarness?: CaptureHarness;
    }
  ).__baciInterestCaptureHarness;
  if (!state) throw new Error('Capture test harness was not initialized');
  return state;
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async () => {
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  return {
    verifyPiggyvestWebhookSecrets: ({
      rawBody,
      signature,
    }: {
      rawBody: Uint8Array;
      signature: string | null;
    }) => {
      const expected = createHmac('sha512', harness.secret)
        .update(rawBody)
        .digest();
      const supplied =
        typeof signature === 'string' && /^[a-f0-9]{128}$/.test(signature)
          ? Buffer.from(signature, 'hex')
          : Buffer.alloc(64);
      const valid = signature !== null && timingSafeEqual(expected, supplied);
      return valid
        ? {
            status: 'verified',
            secret: harness.secret,
            families: ['interest'],
          }
        : { status: 'invalid' };
    },
  };
});
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxRuntime: () => ({
    integrationId: '00000000-0000-4000-8000-000000000004',
    environment: 'production',
    businessId: 'capture-test-business',
    webhookSecret: harness.secret,
    retainedWebhookSecrets: [],
    database: {
      host: 'capture.invalid',
      port: 5432,
      name: 'capture',
      login: 'evidence',
      password: 'test-only',
      certificateAuthority: 'test-only',
    },
  }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-store', () => ({
  createPrimaryWalletPaidInterestInboxStore: () => ({
    enqueue: ({ rawHex, signature }: { rawHex: string; signature: string }) => {
      const eventId = String(
        JSON.parse(Buffer.from(rawHex, 'hex').toString('utf8')).eventId
      );
      const old = harness.records.get(eventId);
      if (harness.enqueueFailure) throw new Error('private database detail');
      if (old) return 'duplicate';
      harness.records.set(eventId, {
        rawHex,
        signature,
        digest: createHash('sha256')
          .update(Buffer.from(rawHex, 'hex'))
          .digest('hex'),
        state: 'pending',
      });
      return 'accepted';
    },
    claim: () => {
      const item = [...harness.records].find(
        ([, record]) => record.state === 'pending'
      );
      if (!item) return [];
      const [eventId, record] = item;
      record.state = 'processing';
      harness.claims++;
      return [
        {
          eventId,
          rawHex: record.rawHex,
          signature: record.signature,
          bodyDigest: record.digest,
          token: `00000000-0000-4000-8000-${String(harness.claims).padStart(12, '0')}`,
          attempts: harness.claims,
        },
      ];
    },
    finish: ({ eventId, outcome }: { eventId: string; outcome: string }) => {
      if (harness.finishFailure) {
        harness.finishFailure = false;
        const record = harness.records.get(eventId);
        if (record) record.state = 'pending';
        throw new Error('simulated finish failure after financial apply');
      }
      const record = harness.records.get(eventId);
      if (record)
        record.state =
          outcome === 'io_retry'
            ? 'pending'
            : outcome === 'credited' || outcome === 'duplicate'
              ? 'processed'
              : 'quarantined';
      return true;
    },
  }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-dispatch', () => ({
  dispatchPrimaryWalletPaidInterest: harness.dispatch,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-runtime', () => ({
  readPrimaryWalletPaidInterestRuntime: () => ({
    integrationId: '00000000-0000-4000-8000-000000000004',
    environment: 'production',
    businessId: 'capture-test-business',
    providerToken: 'provider-test-token',
    webhookSecret: harness.secret,
    retainedWebhookSecrets: [],
    database: {
      host: 'capture.invalid',
      port: 5432,
      name: 'capture',
      login: 'evidence',
      password: 'test-only',
      certificateAuthority: 'test-only',
    },
  }),
}));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeServiceClient: vi.fn(),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: vi.fn(),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: vi.fn(),
}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: vi.fn() }));
