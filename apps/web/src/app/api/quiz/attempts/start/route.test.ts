import {
  EXAM_PASS_POINTS_COST,
  QUIZ_FREE_ENTRY_MODE,
} from '@baci/shared/constants';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { resolveQuizDevice } from '@/lib/quiz/quiz-device-hash';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  // Faithful stub of the real case-insensitive, whitespace-tolerant detection
  // so the route's bearer check matches the auth/CSRF paths in tests too.
  getBearerTokenFromRequest: (request: Request) => {
    const header = request.headers.get('Authorization') ?? '';
    const match = header.match(/^\s*bearer\s+(.+?)\s*$/i);
    return match?.[1]?.trim() || null;
  },
  hasBearerAuthScheme: (request: Request) =>
    /^\s*bearer(?:\s|$)/i.test(request.headers.get('Authorization') ?? ''),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/quiz/quiz-device-hash', () => ({
  QUIZ_DEVICE_COOKIE: 'baci_qdid',
  resolveQuizDevice: vi.fn(),
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-1';
const ORIGINAL_QUIZ_ENV = {
  QUIZ_PHASE: process.env.QUIZ_PHASE,
  QUIZ_PRODUCTION_APPROVED: process.env.QUIZ_PRODUCTION_APPROVED,
  QUIZ_RPC_SERVER_SECRET: process.env.QUIZ_RPC_SERVER_SECRET,
};

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/quiz/attempts/start', {
    body: JSON.stringify(
      body && typeof body === 'object' && !Array.isArray(body)
        ? { entryMode: QUIZ_FREE_ENTRY_MODE, ...body }
        : body
    ),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

// Mobile storefront requests carry a Bearer token (no cookie session). The
// username gate only applies to these bearer-authenticated clients.
function bearerRequest(body: unknown) {
  return new NextRequest('http://localhost/api/quiz/attempts/start', {
    body: JSON.stringify(
      body && typeof body === 'object' && !Array.isArray(body)
        ? { entryMode: QUIZ_FREE_ENTRY_MODE, ...body }
        : body
    ),
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

// A valid-but-lowercase bearer scheme. getBearerTokenFromRequest and the CSRF
// check accept this case-insensitively, so the username gate must too.
function lowercaseBearerRequest(body: unknown) {
  return new NextRequest('http://localhost/api/quiz/attempts/start', {
    body: JSON.stringify(
      body && typeof body === 'object' && !Array.isArray(body)
        ? { entryMode: QUIZ_FREE_ENTRY_MODE, ...body }
        : body
    ),
    headers: {
      Authorization: 'bearer test-token',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

function mockAuthenticatedSupabase({
  eventGuardResult = {
    data: {
      compliance_verified: true,
      merchant_id: 'merchant-1',
      regulatory_basis: 'free_skill_competition',
      regulatory_evidence_ref: 'COUNSEL-2026-08-05',
      regulatory_jurisdiction: 'NG-LA',
    },
    error: null,
  },
  customerAgeResult = {
    data: { date_of_birth: '1990-01-01' },
    error: null,
  },
  rpcResult = {
    data: {
      attemptId: 'attempt-1',
      eventId: EVENT_ID,
      examPassPointsSpent: EXAM_PASS_POINTS_COST,
      remainingLoyaltyPoints: 4,
    },
    error: null,
  },
  readinessResult = { data: true, error: null },
  bindResult = { data: true, error: null },
  user = { id: USER_ID },
}: {
  eventGuardResult?: { data: unknown; error: unknown };
  customerAgeResult?: { data: unknown; error: unknown };
  rpcResult?: { data: unknown; error: unknown };
  readinessResult?: { data: unknown; error: unknown };
  bindResult?: { data: unknown; error: unknown };
  user?: { id: string } | null;
} = {}) {
  const eventGuardBuilder = {
    eq: vi.fn(() => eventGuardBuilder),
    maybeSingle: vi.fn().mockResolvedValue(eventGuardResult),
    select: vi.fn(() => eventGuardBuilder),
  };
  const customerAgeBuilder = {
    eq: vi.fn(() => customerAgeBuilder),
    limit: vi.fn(() => customerAgeBuilder),
    maybeSingle: vi.fn().mockResolvedValue(customerAgeResult),
    order: vi.fn(() => customerAgeBuilder),
    select: vi.fn(() => customerAgeBuilder),
  };
  const from = vi.fn((table: string) => {
    if (table === 'quiz_events') return eventGuardBuilder;
    if (table === 'customers') return customerAgeBuilder;
    return eventGuardBuilder;
  });
  const rpc = vi.fn((name: string) => {
    if (name === 'quiz_free_entry_ready')
      return Promise.resolve(readinessResult);
    if (name === 'quiz_device_cap_ready')
      return Promise.resolve({ data: true, error: null });
    if (name === 'bind_quiz_attempt_device') return Promise.resolve(bindResult);
    if (name === 'start_quiz_attempt_with_device') {
      if (rpcResult.error) return Promise.resolve(rpcResult);
      const startData =
        rpcResult.data && typeof rpcResult.data === 'object'
          ? rpcResult.data
          : {};
      return Promise.resolve({
        data: {
          ...startData,
          deviceAllowed: bindResult.error ? true : bindResult.data,
          deviceBindingFailed: Boolean(bindResult.error),
        },
        error: null,
      });
    }
    return Promise.resolve(rpcResult);
  });
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from,
    rpc,
  };

  vi.mocked(createClient).mockResolvedValue(supabase as never);
  // Bearer (mobile) requests authenticate via authenticateApiRequest instead of
  // the cookie client; return the same mock supabase so both paths share it.
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    supabase,
    user,
  } as never);
  return { customerAgeBuilder, eventGuardBuilder, from, rpc, supabase };
}

describe('start quiz attempt route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QUIZ_RPC_SERVER_SECRET = 'test-secret';
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(resolveQuizDevice).mockReturnValue({
      cookieToSet: undefined,
      deviceHash: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(ORIGINAL_QUIZ_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns 401 before RPC calls when authentication is missing', async () => {
    const { rpc } = mockAuthenticatedSupabase({ user: null });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 403 before RPC calls when CSRF validation fails', async () => {
    const { rpc } = mockAuthenticatedSupabase();
    vi.mocked(checkCsrfProtection).mockResolvedValueOnce({ valid: false });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'CSRF validation failed',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('validates input before calling the start RPC', async () => {
    const { rpc } = mockAuthenticatedSupabase();

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: 'not-a-uuid', integrityTier: 'device' })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid input' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 409 before the start RPC when expectedUserId does not match the session', async () => {
    // Regression (is6TzDuB): an account switch while the POST is deferred (CSRF
    // init/retry) would otherwise consume the NEW shopper's attempt. The pinned
    // expectedUserId is rejected before any RPC mutation.
    const { rpc } = mockAuthenticatedSupabase();

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({
        eventId: EVENT_ID,
        expectedUserId: 'a-different-shopper',
        integrityTier: 'device',
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'session_changed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects legacy clients before creating an attempt', async () => {
    const { rpc } = mockAuthenticatedSupabase();
    const request = new NextRequest(
      'http://localhost/api/quiz/attempts/start',
      {
        body: JSON.stringify({
          eventId: EVENT_ID,
          integrityTier: 'device',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid input' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed before start when the free-entry migration is unavailable', async () => {
    const { rpc } = mockAuthenticatedSupabase({
      readinessResult: {
        data: null,
        error: { message: 'function quiz_free_entry_ready does not exist' },
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'QUIZ_TEMPORARILY_UNAVAILABLE',
      error: 'Super Quiz is temporarily unavailable. Please try again soon.',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('quiz_free_entry_ready');
    expect(rpc).not.toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.anything()
    );
  });

  it('passes validated mobile input through the start RPC', async () => {
    const { rpc } = mockAuthenticatedSupabase();

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      attemptId: 'attempt-1',
      eventId: EVENT_ID,
      examPassPointsSpent: EXAM_PASS_POINTS_COST,
      remainingLoyaltyPoints: 4,
    });
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({
        p_event_id: EVENT_ID,
        p_integrity_tier: 'device',
        p_user_id: USER_ID,
      })
    );
  });

  it('returns 500 when the start RPC fails', async () => {
    const { rpc } = mockAuthenticatedSupabase({
      rpcResult: { data: null, error: { message: 'RPC failed' } },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Quiz request failed' });
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({
        p_event_id: EVENT_ID,
        p_integrity_tier: 'device',
        p_user_id: USER_ID,
      })
    );
    expect(logger.error).toHaveBeenCalledWith({
      error: { message: 'RPC failed' },
      event: 'start_quiz_attempt',
      eventId: EVENT_ID,
      message: 'start_quiz_attempt RPC failed',
      userId: USER_ID,
    });
  });

  // Entry is free, so QZ011 can only mean the PAID entry RPC is still live (the
  // free-entry migration has not applied). Fail closed rather than charging the
  // player or telling them to go and buy loyalty points.
  it('fails closed with 503 when the paid-entry RPC is still live (QZ011)', async () => {
    const { rpc } = mockAuthenticatedSupabase({
      rpcResult: {
        data: null,
        error: { code: 'QZ011', message: 'quiz_exam_pass_required' },
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      code: 'QUIZ_TEMPORARILY_UNAVAILABLE',
      error: 'Super Quiz is temporarily unavailable. Please try again soon.',
    });
    // Must never re-sell the purchase gate that free entry removed.
    expect(JSON.stringify(body)).not.toMatch(/loyalty/i);
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({
        p_event_id: EVENT_ID,
        p_integrity_tier: 'device',
        p_user_id: USER_ID,
      })
    );
    // This is an operational fault, not a normal user outcome: QZ011 means the
    // paid-entry RPC is still live in the database. It must be logged loudly.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'start_quiz_attempt',
        message: expect.stringContaining('paid-entry RPC is still live'),
      })
    );
  });

  // The QZ011 guard above does NOT cover this: the old RPC raised QZ011 only
  // when the player held FEWER points than the cost. A player who held a point
  // was charged and the RPC SUCCEEDED — so the free-entry build would silently
  // spend a loyalty point for exactly the players it promised not to charge.
  it('returns the committed receipt when a drifted start reports a charge', async () => {
    const { rpc } = mockAuthenticatedSupabase({
      rpcResult: {
        data: {
          attemptId: 'attempt-1',
          eventId: EVENT_ID,
          examPassPointsSpent: 1,
          remainingLoyaltyPoints: 4,
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      attemptId: 'attempt-1',
      eventId: EVENT_ID,
      examPassPointsSpent: 1,
      remainingLoyaltyPoints: 4,
    });
    expect(rpc).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'start_quiz_attempt',
        message: expect.stringContaining('readiness marker'),
        pointsSpent: 1,
      })
    );
  });

  it('serves the attempt normally when entry was free', async () => {
    mockAuthenticatedSupabase({
      rpcResult: {
        data: {
          attemptId: 'attempt-1',
          eventId: EVENT_ID,
          examPassPointsSpent: 0,
          remainingLoyaltyPoints: 4,
          question: { id: 'q1', index: 1, total: 5 },
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
  });

  it('ignores a client-supplied fingerprint for cookie-authenticated web starts', async () => {
    mockAuthenticatedSupabase();

    const { POST } = await import('./route');
    await POST(
      jsonRequest({
        deviceFingerprint: 'a'.repeat(64),
        eventId: EVENT_ID,
        integrityTier: 'device',
      })
    );

    expect(resolveQuizDevice).toHaveBeenCalledWith(
      expect.any(NextRequest),
      undefined
    );
  });

  it('uses a validated fingerprint for bearer-authenticated mobile starts', async () => {
    mockAuthenticatedSupabase();
    const fingerprint = 'a'.repeat(64);

    const { POST } = await import('./route');
    await POST(
      bearerRequest({
        deviceFingerprint: fingerprint,
        eventId: EVENT_ID,
        integrityTier: 'device',
      })
    );

    expect(resolveQuizDevice).toHaveBeenCalledWith(
      expect.any(NextRequest),
      fingerprint
    );
  });

  it('does not mint a web device cookie for bearer starts without a fingerprint', async () => {
    const { rpc } = mockAuthenticatedSupabase();

    const { POST } = await import('./route');
    const response = await POST(
      bearerRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    expect(resolveQuizDevice).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('quiz_device_cap_ready');
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({ p_event_id: EVENT_ID })
    );
  });

  it('reuses an existing web device cookie for bearer starts without a fingerprint', async () => {
    const { rpc } = mockAuthenticatedSupabase();
    const request = bearerRequest({
      eventId: EVENT_ID,
      integrityTier: 'device',
    });
    request.cookies.set('baci_qdid', 'existing-device-cookie');
    vi.mocked(resolveQuizDevice).mockReturnValue({
      deviceHash: 'b'.repeat(64),
    });

    const { POST } = await import('./route');
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(resolveQuizDevice).toHaveBeenCalledWith(request, undefined);
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt_with_device',
      expect.objectContaining({ p_device_hash: 'b'.repeat(64) })
    );
  });

  it('starts without device binding when device resolution throws', async () => {
    const { rpc } = mockAuthenticatedSupabase();
    vi.mocked(resolveQuizDevice).mockImplementation(() => {
      throw new Error('randomness unavailable');
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({ p_event_id: EVENT_ID })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'start_quiz_attempt_with_device',
      expect.anything()
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'quiz_device_resolution',
        message:
          'Device identification failed; continuing without device binding',
      })
    );
  });

  it('uses the shared bearer parser for lowercase mobile authorization', async () => {
    mockAuthenticatedSupabase();
    const fingerprint = 'd'.repeat(64);

    const { POST } = await import('./route');
    await POST(
      lowercaseBearerRequest({
        deviceFingerprint: fingerprint,
        eventId: EVENT_ID,
        integrityTier: 'device',
      })
    );

    expect(resolveQuizDevice).toHaveBeenCalledWith(
      expect.any(NextRequest),
      fingerprint
    );
  });

  it('returns the device limit response after persisting an over-cap attempt', async () => {
    const { rpc } = mockAuthenticatedSupabase({
      bindResult: { data: false, error: null },
    });
    vi.mocked(resolveQuizDevice).mockReturnValue({
      cookieToSet: {
        maxAge: 31_536_000,
        name: 'baci_qdid',
        value: 'device-cookie',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
      },
      deviceHash: 'b'.repeat(64),
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'QUIZ_ATTEMPT_LIMIT_REACHED',
      error: "You've reached the maximum number of attempts for this quiz.",
    });
    expect(response.headers.get('set-cookie')).toContain(
      'baci_qdid=device-cookie'
    );
    expect(rpc).toHaveBeenCalledWith('start_quiz_attempt_with_device', {
      p_device_hash: 'b'.repeat(64),
      p_device_route_proof: expect.any(Object),
      p_event_id: EVENT_ID,
      p_integrity_tier: 'device',
      p_start_route_proof: expect.any(Object),
      p_user_id: USER_ID,
    });
  });

  it('fails closed before device start when the device-cap migration is unavailable', async () => {
    const { rpc } = mockAuthenticatedSupabase();
    rpc.mockImplementation((name: string) => {
      if (name === 'quiz_free_entry_ready') {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'quiz_device_cap_ready') {
        return Promise.resolve({
          data: null,
          error: { message: 'function quiz_device_cap_ready does not exist' },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    vi.mocked(resolveQuizDevice).mockReturnValue({
      cookieToSet: {
        maxAge: 31_536_000,
        name: 'baci_qdid',
        value: 'readiness-device-cookie',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
      },
      deviceHash: 'b'.repeat(64),
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'QUIZ_TEMPORARILY_UNAVAILABLE',
      error: 'Super Quiz is temporarily unavailable. Please try again soon.',
    });
    expect(response.headers.get('set-cookie')).toContain(
      'baci_qdid=readiness-device-cookie'
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'start_quiz_attempt_with_device',
      expect.anything()
    );
  });

  it('returns the successful start when device binding fails unexpectedly', async () => {
    mockAuthenticatedSupabase({
      bindResult: {
        data: null,
        error: { code: 'XX000', message: 'unexpected bind failure' },
      },
    });
    vi.mocked(resolveQuizDevice).mockReturnValue({
      cookieToSet: undefined,
      deviceHash: 'c'.repeat(64),
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ attemptId: 'attempt-1' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'start_quiz_attempt_with_device',
        message: 'Device-cap binding failed inside quiz start; continuing',
      })
    );
  });

  it('returns a client error when the event is no longer open', async () => {
    const { rpc } = mockAuthenticatedSupabase({
      rpcResult: {
        data: null,
        error: { code: 'QZ002', message: 'quiz_event_not_open' },
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'QUIZ_EVENT_NOT_OPEN',
      error: 'Quiz event is not open',
    });
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({
        p_event_id: EVENT_ID,
        p_integrity_tier: 'device',
        p_user_id: USER_ID,
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fails closed before starting prize play in production when compliance evidence is missing', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const { eventGuardBuilder, from, rpc } = mockAuthenticatedSupabase({
      eventGuardResult: {
        data: {
          compliance_verified: true,
          regulatory_basis: null,
          regulatory_evidence_ref: null,
          regulatory_jurisdiction: null,
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'quiz_production_not_approved',
      error: 'Quiz prizes are not approved for production use',
    });
    expect(from).toHaveBeenCalledWith('quiz_events');
    expect(eventGuardBuilder.select).toHaveBeenCalledWith(
      'merchant_id, mode, regulatory_basis, regulatory_jurisdiction, regulatory_evidence_ref, compliance_verified'
    );
    expect(eventGuardBuilder.eq).toHaveBeenCalledWith('id', EVENT_ID);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks production quiz start when customer date of birth is missing', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const { customerAgeBuilder, rpc } = mockAuthenticatedSupabase({
      customerAgeResult: {
        data: { date_of_birth: null },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'quiz_age_restricted',
      error: 'Quiz participation requires an adult profile (18+)',
    });
    expect(customerAgeBuilder.select).toHaveBeenCalledWith('date_of_birth');
    expect(customerAgeBuilder.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(customerAgeBuilder.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks a production mobile (bearer) quiz start when the customer has no username', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const { customerAgeBuilder, rpc } = mockAuthenticatedSupabase({
      customerAgeResult: {
        data: { date_of_birth: '1990-01-01', username: null },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      bearerRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'quiz_username_required',
      error: 'Choose a username before starting the quiz',
    });
    expect(customerAgeBuilder.select).toHaveBeenCalledWith('username');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('enforces the username gate for a lowercase bearer scheme (case-insensitive)', async () => {
    // Regression: a stricter startsWith('Bearer ') check let a request that
    // authenticated as bearer via the lowercase `bearer` scheme skip the gate
    // and create a leaderboard attempt with no username.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const { rpc } = mockAuthenticatedSupabase({
      customerAgeResult: {
        data: { date_of_birth: '1990-01-01', username: null },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      lowercaseBearerRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'quiz_username_required',
      error: 'Choose a username before starting the quiz',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not block a production web (cookie) start when the username is missing', async () => {
    // Web has no username-collection UI yet, so the gate is scoped to mobile.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const { rpc } = mockAuthenticatedSupabase({
      customerAgeResult: {
        data: { date_of_birth: '1990-01-01', username: null },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({ p_event_id: EVENT_ID, p_user_id: USER_ID })
    );
  });

  it('starts a production mobile quiz when age and username gates pass', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const { rpc } = mockAuthenticatedSupabase({
      customerAgeResult: {
        data: { date_of_birth: '1990-01-01', username: 'ogafan' },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      bearerRequest({ eventId: EVENT_ID, integrityTier: 'device' })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'start_quiz_attempt',
      expect.objectContaining({
        p_event_id: EVENT_ID,
        p_integrity_tier: 'device',
        p_user_id: USER_ID,
      })
    );
  });
});

describe('quiz start dispatcher', () => {
  afterEach(() => {
    vi.doUnmock('./legacy-route');
    vi.doUnmock('./v2-route');
    vi.resetModules();
  });

  it('dispatches requests without the v2 contract header to the legacy handler', async () => {
    const legacyResponse = Response.json({ contract: 'legacy' });
    const postLegacyQuizStart = vi.fn().mockResolvedValue(legacyResponse);
    const postQuizStartV2 = vi.fn();
    vi.resetModules();
    vi.doMock('./legacy-route', () => ({ postLegacyQuizStart }));
    vi.doMock('./v2-route', () => ({ postQuizStartV2 }));

    const request = jsonRequest({ eventId: EVENT_ID });
    const { POST } = await import('./route');
    expect(await POST(request)).toBe(legacyResponse);
    expect(postLegacyQuizStart).toHaveBeenCalledWith(request);
    expect(postQuizStartV2).not.toHaveBeenCalled();
  });

  it('dispatches contract version 2 requests to the v2 handler', async () => {
    const v2Response = Response.json({ contract: 2 });
    const postLegacyQuizStart = vi.fn();
    const postQuizStartV2 = vi.fn().mockResolvedValue(v2Response);
    vi.resetModules();
    vi.doMock('./legacy-route', () => ({ postLegacyQuizStart }));
    vi.doMock('./v2-route', () => ({ postQuizStartV2 }));

    const request = new NextRequest(
      'http://localhost/api/quiz/attempts/start',
      {
        body: JSON.stringify({ eventId: EVENT_ID }),
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Contract': '2',
        },
        method: 'POST',
      }
    );
    const { POST } = await import('./route');
    expect(await POST(request)).toBe(v2Response);
    expect(postQuizStartV2).toHaveBeenCalledWith(request);
    expect(postLegacyQuizStart).not.toHaveBeenCalled();
  });
});
