import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRouteProof,
  requireQuizCsrf,
  requireQuizUser,
} from '@/app/api/quiz/_shared/route-helpers';
import { QuizAgeGateError } from '@/app/api/quiz/_shared/route-helpers-guards';
import { resolveQuizDevice } from '@/lib/quiz/quiz-device-hash';
import { postQuizStartV2 } from './v2-route';
import { enforceQuizStartGuards } from './v2-start-guards';

vi.mock('./v2-start-guards', () => ({
  enforceQuizStartGuards: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/quiz/_shared/route-helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/api/quiz/_shared/route-helpers')
  >('@/app/api/quiz/_shared/route-helpers');
  return {
    ...actual,
    createRouteProof: vi.fn(),
    requireQuizCsrf: vi.fn(),
    requireQuizUser: vi.fn(),
  };
});
vi.mock('@/lib/quiz/quiz-device-hash', () => ({
  QUIZ_DEVICE_COOKIE: 'baci_qdid',
  resolveQuizDevice: vi.fn(),
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const FINGERPRINT = 'a'.repeat(64);

const attempt = {
  attemptId: '44444444-4444-4444-8444-444444444444',
  eventEndsAt: '2026-08-05T10:05:00.000Z',
  eventId: EVENT_ID,
  question: {
    deadlineAt: '2026-08-05T10:00:10.000Z',
    id: '55555555-5555-4555-8555-555555555555',
    index: 1,
    issuedAt: '2026-08-05T10:00:00.000Z',
    options: [{ id: 'a', label: 'A' }],
    prompt: 'Question?',
    timeLimitSeconds: 10,
    total: 20,
  },
  resultsAvailableAt: null,
  serverNow: '2026-08-05T10:00:00.000Z',
  status: 'in_progress',
};

function request(body: Record<string, unknown>, headers = {}) {
  return new NextRequest('https://shop.test/api/quiz/attempts/start', {
    body: JSON.stringify({
      acceptedRulesVersion: 'rules-v1',
      appVersion: '1.2.3',
      entryMode: 'free-v1',
      eventId: EVENT_ID,
      expectedUserId: USER_ID,
      integrityTier: 'device',
      platform: 'ios',
      startRequestId: REQUEST_ID,
      termsAccepted: true,
      ...body,
    }),
    headers: {
      'Content-Type': 'application/json',
      'X-Baci-Quiz-Contract': '2',
      ...headers,
    },
    method: 'POST',
  });
}

function authenticated() {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'quiz_runtime_contract_version'
        ? { data: 2, error: null }
        : { data: { ...attempt, deviceAllowed: true }, error: null }
    )
  );
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod: 'bearer',
    response: null,
    supabase: { rpc },
    user: { id: USER_ID },
  } as never);
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireQuizCsrf).mockResolvedValue(null);
  vi.mocked(createRouteProof).mockReturnValue({
    proof: { proof_id: 'proof' },
    response: null,
  } as never);
  vi.mocked(resolveQuizDevice).mockReturnValue({ deviceHash: 'b'.repeat(64) });
});

describe('v2 quiz start route', () => {
  it('returns the age restriction without issuing a start RPC', async () => {
    const rpc = authenticated();
    vi.mocked(enforceQuizStartGuards).mockRejectedValueOnce(
      new QuizAgeGateError('Age restricted')
    );
    const response = await postQuizStartV2(request({}));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'quiz_age_restricted',
    });
    expect(rpc).not.toHaveBeenCalledWith(
      expect.stringMatching(/^start_quiz_attempt/),
      expect.anything()
    );
  });
  it('authenticates before CSRF, validation, or RPC work', async () => {
    vi.mocked(requireQuizUser).mockResolvedValue({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as never);
    expect((await postQuizStartV2(request({}))).status).toBe(401);
    expect(requireQuizCsrf).not.toHaveBeenCalled();
  });

  it('fails closed on CSRF, contract, validation, identity, and runtime drift', async () => {
    const rpc = authenticated();
    vi.mocked(requireQuizCsrf).mockResolvedValueOnce(
      NextResponse.json({ error: 'CSRF' }, { status: 403 })
    );
    expect((await postQuizStartV2(request({}))).status).toBe(403);

    vi.mocked(requireQuizCsrf).mockResolvedValue(null);
    expect(
      (await postQuizStartV2(request({}, { 'X-Baci-Quiz-Contract': '1' })))
        .status
    ).toBe(426);
    expect(
      (await postQuizStartV2(request({ termsAccepted: false }))).status
    ).toBe(400);
    expect(
      (await postQuizStartV2(request({ expectedUserId: 'other-user' }))).status
    ).toBe(409);

    rpc.mockResolvedValueOnce({ data: 1, error: null });
    expect((await postQuizStartV2(request({}))).status).toBe(503);
  });

  it('uses only the fingerprint header and the v2 RPC/proofs', async () => {
    const rpc = authenticated();
    const response = await postQuizStartV2(
      request({}, { 'X-Baci-Quiz-Device-Fingerprint': FINGERPRINT })
    );
    expect(response.status).toBe(200);
    expect(resolveQuizDevice).toHaveBeenCalledWith(
      expect.anything(),
      FINGERPRINT
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'start_quiz_attempt_with_device_v2',
      expect.objectContaining({
        p_event_id: EVENT_ID,
        p_start_request_id: REQUEST_ID,
      })
    );
    expect(await response.json()).toEqual(attempt);

    expect(
      (await postQuizStartV2(request({ deviceFingerprint: FINGERPRINT })))
        .status
    ).toBe(400);
  });
});
