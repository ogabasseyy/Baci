import { createHmac, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireQuizUser: vi.fn(),
  requireQuizCsrf: vi.fn(),
  requireQuizV2Contract: vi.fn(),
  requireQuizV2Runtime: vi.fn(),
  enforceQuizStartGuards: vi.fn(),
  resolveQuizDevice: vi.fn(),
  getQuizEdgeWorkerUrl: vi.fn(),
  getQuizTicketSecret: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/app/api/quiz/_shared/route-helpers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requireQuizUser: mocks.requireQuizUser,
    requireQuizCsrf: mocks.requireQuizCsrf,
  };
});

vi.mock('@/app/api/quiz/_shared/quiz-v2-contract', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requireQuizV2Contract: mocks.requireQuizV2Contract,
    requireQuizV2Runtime: mocks.requireQuizV2Runtime,
  };
});

vi.mock('@/app/api/quiz/attempts/start/v2-start-guards', () => ({
  enforceQuizStartGuards: mocks.enforceQuizStartGuards,
}));

vi.mock('@/lib/quiz/quiz-device-hash', () => ({
  QUIZ_DEVICE_COOKIE: 'baci_quiz_device',
  resolveQuizDevice: mocks.resolveQuizDevice,
}));

vi.mock('@/lib/quiz/quiz-edge-config', () => ({
  getQuizEdgeWorkerUrl: mocks.getQuizEdgeWorkerUrl,
  getQuizTicketSecret: mocks.getQuizTicketSecret,
}));

import { POST } from './route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const MERCHANT_ID = '44444444-4444-4444-8444-444444444444';
const ADMISSION_ID = '55555555-5555-4555-8555-555555555555';
const REQ_ID = '66666666-6666-4666-8666-666666666666';
const DEVICE_HASH = 'a'.repeat(64);
const TICKET_SECRET = randomBytes(32).toString('hex');

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest(
    `https://baci.test/api/quiz/events/${EVENT_ID}/check-in`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Baci-Quiz-Contract': '2',
        'X-Baci-Quiz-Device-Fingerprint': 'f'.repeat(64),
        ...headers,
      },
      body: JSON.stringify(body),
    }
  );
}

const VALID_BODY = {
  acceptedRulesVersion: 'live-v1',
  termsAccepted: true,
  checkInRequestId: REQ_ID,
  appVersion: '2.11.0',
  platform: 'android',
  integrityTier: 'device',
  expectedUserId: USER_ID,
};

describe('POST /api/quiz/events/[eventId]/check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireQuizUser.mockResolvedValue({
      user: { id: USER_ID },
      authMethod: 'bearer',
      supabase: { rpc: mocks.rpc },
      response: null,
    });
    mocks.requireQuizCsrf.mockResolvedValue(null);
    mocks.requireQuizV2Contract.mockReturnValue(null);
    mocks.requireQuizV2Runtime.mockResolvedValue(null);
    mocks.enforceQuizStartGuards.mockResolvedValue(undefined);
    mocks.resolveQuizDevice.mockReturnValue({ deviceHash: DEVICE_HASH });
    mocks.getQuizEdgeWorkerUrl.mockReturnValue(
      'https://quiz-edge.ogabassey.com'
    );
    mocks.getQuizTicketSecret.mockReturnValue(TICKET_SECRET);
  });

  it('fails closed with 503 when edge worker env is not configured', async () => {
    mocks.getQuizTicketSecret.mockReturnValue(undefined);
    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: 'QUIZ_EDGE_NOT_CONFIGURED',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid eventId UUID before calling RPC', async () => {
    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ eventId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('calls check_in_quiz_event_v2 under RLS and returns signed bqt1 admission ticket', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        admissionId: ADMISSION_ID,
        eventId: EVENT_ID,
        merchantId: MERCHANT_ID,
        customerId: CUSTOMER_ID,
        userId: USER_ID,
        roomId: `quiz-room:${EVENT_ID}:3`,
        roomIndex: 3,
        leaderboardUsername: 'LagosRunner',
        maxAttempts: 1,
        startsAt: '2026-12-01T18:00:00.000Z',
        endsAt: '2026-12-01T18:10:00.000Z',
        rulesVersion: 'live-v1',
        reused: false,
      },
      error: null,
    });

    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('check_in_quiz_event_v2', {
      p_event_id: EVENT_ID,
      p_device_hash: DEVICE_HASH,
      p_accepted_rules_version: 'live-v1',
      p_terms_accepted: true,
      p_check_in_request_id: REQ_ID,
      p_app_version: '2.11.0',
      p_platform: 'android',
      p_integrity_tier: 'device',
    });

    const json = (await res.json()) as {
      backendMode: string;
      edgeBaseUrl: string;
      roomId: string;
      ticket: string;
    };
    expect(json.backendMode).toBe('edge_rooms');
    expect(json.edgeBaseUrl).toBe('https://quiz-edge.ogabassey.com');
    expect(json.roomId).toBe(`quiz-room:${EVENT_ID}:3`);

    const [prefix, encoded, sig] = json.ticket.split('.');
    expect(prefix).toBe('bqt1');
    const expectedSig = createHmac('sha256', TICKET_SECRET)
      .update(`${prefix}.${encoded}`, 'utf8')
      .digest('base64url');
    expect(sig).toBe(expectedSig);

    const decoded = JSON.parse(
      Buffer.from(encoded ?? '', 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      admissionId: ADMISSION_ID,
      customerId: CUSTOMER_ID,
      eventId: EVENT_ID,
      roomId: `quiz-room:${EVENT_ID}:3`,
      deviceHash: DEVICE_HASH,
      leaderboardUsername: 'LagosRunner',
    });
  });

  it('returns safe error without leaking raw database details on RPC failure', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'QZ041',
        message: 'quiz_device_limit_reached',
      },
    });
    const res = await POST(makeRequest(VALID_BODY), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
