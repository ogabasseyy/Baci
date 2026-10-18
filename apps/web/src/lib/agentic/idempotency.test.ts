import { describe, expect, it, vi } from 'vitest';
import {
  IDEMPOTENCY_PARAMETER_MISMATCH_ERROR,
  IDEMPOTENCY_RESERVATION_FAILED_ERROR,
  IDEMPOTENCY_TRANSIENT_LOOKUP_ERROR,
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { hashIdempotencyRequest } from '@/lib/agentic/idempotency-hash';

const defaultFingerprint = {
  apiVersion: '2026-04-30',
  method: 'POST',
  pathname: '/api/agentic/checkout_sessions',
};

function createSupabaseMock({
  existingRecord = null,
  insertError = null,
  staleReservationUpdateData = null,
  staleReservationUpdateError = null,
  selectError = null,
  updateData = { id: 'idem-record-1' },
  updateError = null,
}: {
  existingRecord?: Record<string, unknown> | null;
  insertError?: { code?: string; message?: string } | null;
  staleReservationUpdateData?: Record<string, unknown> | null;
  staleReservationUpdateError?: { code?: string; message?: string } | null;
  selectError?: { code?: string; message?: string } | null;
  updateData?: Record<string, unknown> | null;
  updateError?: { code?: string; message?: string } | null;
} = {}) {
  const deleteEq = vi.fn();
  const deleteLt = vi.fn().mockResolvedValue({ error: null });
  const deleteChain = {
    eq: deleteEq,
    lt: deleteLt,
  };
  deleteEq.mockReturnValue(deleteChain);
  const maybeSingle = vi.fn().mockResolvedValue({
    data: selectError ? null : existingRecord,
    error: selectError,
  });
  const selectChain = {
    eq: vi.fn(),
    maybeSingle,
  };
  selectChain.eq.mockReturnValue(selectChain);

  const insertSelect = vi.fn(() => ({
    maybeSingle: vi.fn().mockResolvedValue({
      data: insertError ? null : { id: 'idem-record-1' },
      error: insertError,
    }),
  }));
  const updateEq = vi.fn();
  const updateIs = vi.fn();
  const updateLt = vi.fn();
  const updateChain = {
    eq: updateEq,
    is: updateIs,
    lt: updateLt,
    maybeSingle: vi.fn().mockResolvedValue({
      data: updateError ? null : updateData,
      error: updateError,
    }),
    select: vi.fn(),
  };
  updateEq.mockReturnValue(updateChain);
  updateIs.mockReturnValue(updateChain);
  updateLt.mockReturnValue(updateChain);
  updateChain.select.mockReturnValue(updateChain);
  const staleReservationUpdateChain = {
    eq: vi.fn(),
    is: vi.fn(),
    lt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: staleReservationUpdateError ? null : staleReservationUpdateData,
      error: staleReservationUpdateError,
    }),
    select: vi.fn(),
  };
  staleReservationUpdateChain.eq.mockReturnValue(staleReservationUpdateChain);
  staleReservationUpdateChain.is.mockReturnValue(staleReservationUpdateChain);
  staleReservationUpdateChain.lt.mockReturnValue(staleReservationUpdateChain);
  staleReservationUpdateChain.select.mockReturnValue(
    staleReservationUpdateChain
  );
  const update = vi.fn((payload: Record<string, unknown>) =>
    'expires_at' in payload ? staleReservationUpdateChain : updateChain
  );
  const from = vi.fn(() => ({
    delete: vi.fn(() => deleteChain),
    insert: vi.fn(() => ({ select: insertSelect })),
    select: vi.fn(() => selectChain),
    update,
  }));

  return {
    from,
    deleteEq,
    deleteLt,
    maybeSingle,
    supabase: { from },
    staleReservationUpdateChain,
    update,
    updateChain,
    updateEq,
  };
}

describe('agentic idempotency', () => {
  it('scopes receipt reservations to the platform caller', async () => {
    const mock = createSupabaseMock();
    let inserted: Record<string, unknown> | null = null;
    const supabase = {
      from: (table: string) => {
        const chain = (
          mock.supabase.from as (
            name: string
          ) => ReturnType<typeof mock.supabase.from>
        )(table);
        return {
          ...chain,
          insert: (payload: Record<string, unknown>) => {
            inserted = payload;
            return (
              chain.insert as (value: Record<string, unknown>) => unknown
            )(payload);
          },
        };
      },
    };
    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      agentId: 'agent-a',
      body: '{"items":[]}',
      key: 'idem-1',
      merchantId: 'merchant-1',
      route: 'carts.create',
      supabase: supabase as never,
    });
    expect(result).toEqual({ ok: true, state: 'reserved' });
    expect(inserted).toMatchObject({ agent_id: 'agent-a' });
  });

  it('replays and claims a legacy unscoped receipt when caller ownership is verified', async () => {
    const body = '{"items":[]}';
    const requestHash = hashIdempotencyRequest({
      ...defaultFingerprint,
      body,
    });
    const legacyRecord = {
      request_hash: requestHash,
      response_body: { agent_id: 'agent-a', id: 'session-legacy-1' },
      status_code: 201,
    };
    const mock = createSupabaseMock({
      existingRecord: legacyRecord,
      updateData: legacyRecord,
    });
    const insertSpy = vi.fn();
    const supabase = {
      from: (table: string) => {
        const chain = (
          mock.supabase.from as (
            name: string
          ) => ReturnType<typeof mock.supabase.from>
        )(table);
        return {
          ...chain,
          insert: insertSpy,
        };
      },
    };

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      agentId: 'agent-a',
      body,
      key: 'idem-legacy-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: true,
      requestHash,
      response: { agent_id: 'agent-a', id: 'session-legacy-1' },
      state: 'replay',
      status: 201,
    });
    expect(mock.update).toHaveBeenCalledWith({ agent_id: 'agent-a' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('does not replay a legacy unscoped receipt belonging to a different caller', async () => {
    const body = '{"items":[]}';
    const requestHash = hashIdempotencyRequest({
      ...defaultFingerprint,
      body,
    });
    const mock = createSupabaseMock({
      existingRecord: {
        request_hash: requestHash,
        response_body: { agent_id: 'agent-a', id: 'session-legacy-1' },
        status_code: 201,
      },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      agentId: 'agent-b',
      body,
      key: 'idem-legacy-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({ ok: true, state: 'reserved' });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('reserves a new idempotency key before mutation', async () => {
    const mock = createSupabaseMock();
    const body = '{"items":[]}';

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body,
      key: 'idem-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({ ok: true, state: 'reserved' });
    expect(mock.from).toHaveBeenCalledWith('agentic_idempotency_records');
  });

  it('replays a stored response when key and request hash match', async () => {
    const body = '{"items":[]}';
    const mock = createSupabaseMock({
      existingRecord: {
        request_hash: hashIdempotencyRequest({
          ...defaultFingerprint,
          body,
        }),
        response_body: { id: 'session-1' },
        status_code: 201,
      },
      insertError: { code: '23505', message: 'duplicate key' },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body,
      key: 'idem-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({
      ok: true,
      requestHash: hashIdempotencyRequest({
        ...defaultFingerprint,
        body,
      }),
      response: { id: 'session-1' },
      state: 'replay',
      status: 201,
    });
  });

  it('returns conflict when the key is reused with a different body', async () => {
    const mock = createSupabaseMock({
      existingRecord: {
        request_hash: hashIdempotencyRequest({
          ...defaultFingerprint,
          body: '{"items":[]}',
        }),
        response_body: { id: 'session-1' },
        status_code: 201,
      },
      insertError: { code: '23505', message: 'duplicate key' },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body: '{"items":[{"id":"changed"}]}',
      key: 'idem-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      error: IDEMPOTENCY_PARAMETER_MISMATCH_ERROR,
    });
  });

  it('returns conflict when the key is reused for a different session path', async () => {
    const body = '{}';
    const mock = createSupabaseMock({
      existingRecord: {
        request_hash: hashIdempotencyRequest({
          apiVersion: '2026-04-30',
          body,
          method: 'POST',
          pathname: '/api/agentic/checkout_sessions/agentic_session_1/cancel',
        }),
        response_body: { id: 'agentic_session_1', status: 'canceled' },
        status_code: 200,
      },
      insertError: { code: '23505', message: 'duplicate key' },
    });

    const result = await reserveAgenticIdempotencyKey({
      apiVersion: '2026-04-30',
      body,
      key: 'idem-1',
      merchantId: 'merchant-1',
      method: 'POST',
      pathname: '/api/agentic/checkout_sessions/agentic_session_2/cancel',
      route: 'checkout_sessions.cancel',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      error: IDEMPOTENCY_PARAMETER_MISMATCH_ERROR,
    });
  });

  it('reclaims a stale in-progress reservation for the same request', async () => {
    const body = '{"items":[]}';
    const now = new Date('2026-04-30T12:00:00.000Z');
    const mock = createSupabaseMock({
      existingRecord: {
        request_hash: hashIdempotencyRequest({
          ...defaultFingerprint,
          body,
        }),
        response_body: null,
        status_code: null,
        updated_at: '2026-04-30T11:55:00.000Z',
      },
      insertError: { code: '23505', message: 'duplicate key' },
      staleReservationUpdateData: { id: 'idem-record-1' },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body,
      key: 'idem-1',
      merchantId: 'merchant-1',
      now,
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({ ok: true, state: 'reserved' });
    expect(mock.staleReservationUpdateChain.lt).toHaveBeenCalledWith(
      'updated_at',
      '2026-04-30T11:58:00.000Z'
    );
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        updated_at: '2026-04-30T12:00:00.000Z',
      })
    );
  });

  it('returns reservation failure when stale reservation reclaim fails', async () => {
    const body = '{"items":[]}';
    const now = new Date('2026-04-30T12:00:00.000Z');
    const mock = createSupabaseMock({
      existingRecord: {
        request_hash: hashIdempotencyRequest({
          ...defaultFingerprint,
          body,
        }),
        response_body: null,
        status_code: null,
        updated_at: '2026-04-30T11:55:00.000Z',
      },
      insertError: { code: '23505', message: 'duplicate key' },
      staleReservationUpdateError: {
        code: 'PGRST000',
        message: 'database unavailable',
      },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body,
      key: 'idem-1',
      merchantId: 'merchant-1',
      now,
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      error: IDEMPOTENCY_RESERVATION_FAILED_ERROR,
    });
  });

  it('returns reservation failure when the existing record lookup fails', async () => {
    const mock = createSupabaseMock({
      insertError: { code: '23505', message: 'duplicate key' },
      selectError: { code: 'PGRST000', message: 'lookup failed' },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body: '{"items":[]}',
      key: 'idem-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      error: IDEMPOTENCY_RESERVATION_FAILED_ERROR,
    });
  });

  it('returns a transient lookup error when a duplicate key record disappears', async () => {
    const mock = createSupabaseMock({
      existingRecord: null,
      insertError: { code: '23505', message: 'duplicate key' },
    });

    const result = await reserveAgenticIdempotencyKey({
      ...defaultFingerprint,
      body: '{"items":[]}',
      key: 'idem-1',
      merchantId: 'merchant-1',
      route: 'checkout_sessions.create',
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      error: IDEMPOTENCY_TRANSIENT_LOOKUP_ERROR,
    });
  });

  it('stores the final response for future replay', async () => {
    const mock = createSupabaseMock();

    const result = await storeAgenticIdempotencyResponse({
      key: 'idem-1',
      merchantId: 'merchant-1',
      response: { id: 'session-1' },
      route: 'checkout_sessions.create',
      status: 201,
      supabase: mock.supabase as never,
    });

    expect(result).toEqual({ error: null, ok: true });
    expect(mock.updateEq).toHaveBeenCalledWith(
      'route',
      'checkout_sessions.create'
    );
    expect(mock.updateEq).toHaveBeenCalledWith('idempotency_key', 'idem-1');
    expect(mock.updateEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
  });

  it('returns failure when the response record no longer exists', async () => {
    const mock = createSupabaseMock({ updateData: null });

    const result = await storeAgenticIdempotencyResponse({
      key: 'idem-1',
      merchantId: 'merchant-1',
      response: { id: 'session-1' },
      route: 'checkout_sessions.create',
      status: 201,
      supabase: mock.supabase as never,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});
