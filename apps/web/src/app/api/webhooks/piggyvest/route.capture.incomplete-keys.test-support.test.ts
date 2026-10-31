import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));

import { verifyPiggyvestPayloadSignature } from '@/lib/piggyvest/verify-piggyvest-payload-signature';
import { collectPiggyvestWebhookSecretsWithStatus } from '@/lib/piggyvest/webhook-secret-union';
import { testKey } from '@/lib/piggyvest/webhook-secret-union.test-support';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';
import {
  archiveWithBankAssignment,
  COMPLETE_ARCHIVE_WITHOUT_BANK,
  inflow,
  replayDrain,
  sign,
  UNREADABLE_ARCHIVE,
} from './route.capture.incomplete-keys.test-support';
import { createFakeCaptureStore } from './route.capture-test-support';

const key = testKey('incomplete-keys-support');
const keysFor = (archive: string) =>
  collectPiggyvestWebhookSecretsWithStatus({
    NODE_ENV: 'test',
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive,
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('inflow and sign', () => {
  it('is a bank inflow event the receiver schema accepts', () => {
    const parsed = piggyvestWebhookEventSchema.safeParse(JSON.parse(inflow));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.eventType).toBe('bank-transfer.inflow.success');
  });

  it('is signed over the exact wire bytes under the key it claims', () => {
    const payload = new TextEncoder().encode(inflow);

    expect(
      verifyPiggyvestPayloadSignature({
        payload,
        signature: sign(key, inflow),
        secret: key,
      })
    ).toBe(true);
    expect(
      verifyPiggyvestPayloadSignature({
        payload,
        signature: sign(key, inflow),
        secret: testKey('another'),
      })
    ).toBe(false);
  });
});

describe('archive fixtures', () => {
  it('gives the shared key an in-overlap bank assignment the union loads', () => {
    const keys = keysFor(archiveWithBankAssignment(key));

    expect(keys.misconfigured).toBe(false);
    expect(keys.secrets).toContainEqual(
      expect.objectContaining({
        secret: key,
        family: 'bank',
        status: 'overlap',
      })
    );
  });

  it('is complete but holds no bank assignment when the archive is empty', () => {
    const keys = keysFor(COMPLETE_ARCHIVE_WITHOUT_BANK);

    expect(keys.misconfigured).toBe(false);
    expect(keys.secrets.some((entry) => entry.family === 'bank')).toBe(false);
  });

  it('marks the key set incomplete when the archive is unreadable', () => {
    expect(keysFor(UNREADABLE_ARCHIVE).misconfigured).toBe(true);
  });
});

describe('replayDrain', () => {
  it('drains an empty store without claiming anything', async () => {
    const store = createFakeCaptureStore();

    expect(await replayDrain(store)).toEqual({
      claimed: 0,
      processed: 0,
      retried: 0,
      needsReview: 0,
    });
    expect(store.resolveCalls).toEqual([]);
  });

  it('claims a stored row and records its resolution through the store (deferred while no key is configured)', async () => {
    vi.stubEnv('PIGGYVEST_SECRET_KEY', '');
    vi.stubEnv('PVB_SECRET_KEY', '');
    const store = createFakeCaptureStore();
    const raw = Buffer.from(inflow);
    store.capture({
      rawHex: raw.toString('hex'),
      bodyDigest: createHash('sha256').update(raw).digest('hex'),
      signature: sign(key, inflow),
      eventId: 'evt-incomplete-1',
      eventType: 'bank-transfer.inflow.success',
      providerTransactionId: null,
      headers: {},
      keyVersion: 'k-0123456789abcdef',
      keyFamilies: ['legacy'],
      keyStatus: 'current',
    });

    const summary = await replayDrain(store);

    expect(summary).toMatchObject({ claimed: 1, retried: 1 });
    expect(store.resolveCalls).toEqual([
      expect.objectContaining({
        p_state: 'deferred',
        p_error: 'KEYS_UNCONFIGURED',
      }),
    ]);
    expect(store.rows[0]?.processingState).toBe('pending');
  });
});
