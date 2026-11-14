import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GL-D: the receiver reaches the database only through the restricted
 * `baci_piggyvest_webhook_intake` login. The real route, key union, intake
 * client facade and executor run end to end; only `pg` is replaced by a
 * scripted database that answers by function name, and the service-role
 * factory is a spy that must never be called.
 */

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  clients: [] as Array<{ user: unknown }>,
  ended: 0,
  calls: [] as Array<{ fn: string; payload: unknown }>,
  script: {} as Record<string, () => unknown>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: { user: unknown }) {
      mocks.clients.push({ user: options.user });
    }
    connect = vi.fn(async () => undefined);
    on = vi.fn();
    end = vi.fn(async () => {
      mocks.ended += 1;
    });
    query = vi.fn(async (sql: string, params?: string[]) => {
      if (sql.includes('current_database()')) {
        return {
          rows: [
            {
              database_name: 'postgres',
              login_name: 'baci_piggyvest_webhook_intake',
              role_name: 'baci_piggyvest_webhook_intake',
              safe: true,
              tls: true,
            },
          ],
        };
      }
      const fn = /piggyvest_webhook_intake\.(\w+)\(/.exec(sql)?.[1] ?? '';
      mocks.calls.push({ fn, payload: JSON.parse(params?.[0] ?? 'null') });
      const answer = mocks.script[fn];
      if (!answer) throw new Error(`unscripted ${fn}`);
      return { rows: [{ result: answer() }] };
    });
  },
}));

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import { POST } from './route';
import { inflowEvent } from './route.test-support';

const freshKey = deterministicKeySource('route.least-privilege');
const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const sign = (secret: string, body: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

function post(body: string, signature?: string) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'x-pvb-signature': signature } : {}),
      },
    })
  );
}

const body = JSON.stringify(inflowEvent);
let secret: string;
let alerts: ReturnType<typeof vi.spyOn>;

function stubDatabaseSettings() {
  vi.stubEnv('PIGGYVEST_PRIMARY_DB_HOST', 'db.example.com');
  vi.stubEnv('PIGGYVEST_PRIMARY_DB_PORT', '5432');
  vi.stubEnv('PIGGYVEST_PRIMARY_DB_NAME', 'postgres');
  vi.stubEnv('PIGGYVEST_PRIMARY_DB_CA', 'test-ca');
  vi.stubEnv('PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD', 'test-only');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clients.length = 0;
  mocks.ended = 0;
  mocks.calls.length = 0;
  secret = freshKey();
  vi.stubEnv('PIGGYVEST_SECRET_KEY', secret);
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  stubDatabaseSettings();
  mocks.script = {
    capture_delivery: () => ({
      outcome: 'captured',
      id: uuid(1),
      processingState: 'pending',
    }),
    inbox_insert: () => [{ event_id: inflowEvent.eventId }],
    claim_event: () => ({ outcome: 'claimed', claim_token: uuid(2) }),
    plan_wallet_read: () => ({
      customer_id: uuid(3),
      merchant_id: uuid(4),
      piggyvest_customer_id: inflowEvent.customer_id,
      wallet_id: inflowEvent.pvb_wallet,
      status: 'ready',
    }),
    inflow_credit_insert: () => [
      {
        pvb_reference: inflowEvent.pvb_reference,
        provider_transaction_id: inflowEvent.eventData.transaction_id,
      },
    ],
    allocate_plan_transfer: () => [],
    resolve_event: () => true,
    resolve_capture: () => true,
  };
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PiggyVest webhook least privilege', () => {
  it('captures, claims, credits and resolves through the restricted login only', async () => {
    const response = await post(body, sign(secret, body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
    expect(mocks.calls.map((call) => call.fn)).toEqual([
      'capture_delivery',
      'inbox_insert',
      'claim_event',
      'plan_wallet_read',
      'inflow_credit_insert',
      'allocate_plan_transfer',
      'resolve_event',
      'resolve_capture',
    ]);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    // one connection for the whole delivery, closed when it ends
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.ended).toBe(1);
    expect(
      mocks.clients.every((c) => c.user === 'baci_piggyvest_webhook_intake')
    ).toBe(true);
  });

  it('stores the verified signature and raw bytes before processing starts', async () => {
    await post(body, sign(secret, body));

    const capture = mocks.calls[0];
    expect(capture?.fn).toBe('capture_delivery');
    expect(capture?.payload).toMatchObject({
      signature: sign(secret, body),
      rawHex: Buffer.from(body).toString('hex'),
      keyStatus: 'current',
    });
  });

  it('fails closed with 503 and an alert when the login settings are unset, never reaching for service-role', async () => {
    vi.stubEnv('PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD', '');

    const response = await post(body, sign(secret, body));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Event intake unavailable',
      code: 'PIGGYVEST_CAPTURE_UNAVAILABLE',
    });
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_CAPTURE_FAILED')
    );
    expect(mocks.clients).toEqual([]);
    expect(mocks.calls).toEqual([]);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('answers 503 when the capture write fails, with no processing attempted', async () => {
    mocks.script.capture_delivery = () => {
      throw new Error('storage down');
    };

    const response = await post(body, sign(secret, body));

    expect(response.status).toBe(503);
    expect(mocks.calls.map((call) => call.fn)).toEqual(['capture_delivery']);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.ended).toBe(1);
  });

  it('closes the single connection when processing throws', async () => {
    mocks.script.claim_event = () => {
      throw new Error('lease store down');
    };

    await post(body, sign(secret, body));

    expect(mocks.clients).toHaveLength(1);
    expect(mocks.ended).toBe(1);
  });

  it('rejects a bad signature with 401 before any database connection exists', async () => {
    const response = await post(body, sign(freshKey(), body));

    expect(response.status).toBe(401);
    expect(mocks.clients).toEqual([]);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('still answers 503 without a signing key, before any database connection exists', async () => {
    vi.stubEnv('PIGGYVEST_SECRET_KEY', '');

    const response = await post(body, sign(secret, body));

    expect(response.status).toBe(503);
    expect(mocks.clients).toEqual([]);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
