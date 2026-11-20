import { OXYGEN_REPAYMENT_HISTORY_LIMIT } from '@baci/shared/schemas/oxygen-order-plan';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  rpc: vi.fn(),
  single: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: mocks.read,
}));

import { GET } from './route';

const orderId = '690a9d2e-33b7-4106-8c68-b9019f814dce';
const request = (id = orderId) =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/order-plan?orderId=${id}`
  );
beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mocks.single,
  };
  mocks.from.mockReturnValue(query);
  mocks.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { from: mocks.from, rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.single.mockResolvedValue({ data: { id: 'workflow' }, error: null });
});
it('rejects unauthenticated and invalid input before database reads', async () => {
  mocks.auth.mockResolvedValueOnce({ user: null });
  expect((await GET(request())).status).toBe(401);
  expect((await GET(request('invalid'))).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('returns no plan for orders hidden by customer RLS without reading a snapshot', async () => {
  mocks.single.mockResolvedValue({ data: null, error: null });
  expect(await (await GET(request())).json()).toEqual({ plan: null });
  expect(mocks.read).not.toHaveBeenCalled();
});
it('projects only saved plan facts, excluding identity, provider links and references', async () => {
  mocks.read.mockResolvedValue({
    state: {
      phone: 'private',
      paymentUrl: 'private',
      booking: {
        loan_reference: 'private',
        total_upfront_payment: 52432.88,
        loan_tenure: 3,
      },
      paymentComplete: true,
      schedule: [
        {
          period: 1,
          dueDate: [2026, 11, 27],
          amount: 55658,
          principal: 49000,
          interest: 6658,
        },
      ],
    },
  });
  const response = await GET(request());
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    plan: {
      upfront: 52432.88,
      upfrontConfirmed: true,
      activationConfirmed: false,
      months: 3,
      schedule: [{ period: 1, dueDate: [2026, 11, 27], amount: 55658 }],
      scheduleIncomplete: true,
    },
  });
});
it('reports saved-plan failures without leaking errors', async () => {
  mocks.read.mockRejectedValue(new Error('private'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Plan unavailable' });
});

it('projects activation only from the canonical activated workflow and booking', async () => {
  const state = {
    booking: {
      status: 'ACTIVATED',
      total_upfront_payment: 52432.88,
      loan_tenure: 3,
    },
    paymentComplete: true,
    schedule: [],
  };
  mocks.read.mockResolvedValue({ stage: 'payment_required', state });
  expect((await (await GET(request())).json()).plan.activationConfirmed).toBe(
    false
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ stage: 'activated', state });
  expect((await (await GET(request())).json()).plan.activationConfirmed).toBe(
    true
  );
});

it('returns only customer-safe acknowledgement fields for the activated order', async () => {
  mocks.read.mockResolvedValue({
    stage: 'activated',
    state: { booking: { status: 'ACTIVATED', loan_tenure: 3 }, schedule: [] },
  });
  const receipt = {
    id: 'bb3955b1-0571-49eb-919f-6a6946fdb00b',
    recordedAt: '2026-11-20T12:00:00+00:00',
  };
  mocks.rpc.mockResolvedValue({
    data: [
      { ...receipt, transactionReference: 'private' },
      { id: 'malformed', recordedAt: receipt.recordedAt },
    ],
    error: null,
  });
  const { plan } = await (await GET(request())).json();
  expect(plan.repaymentReceipts).toEqual([receipt]);
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith('oxygen_order_repayment_receipts', {
    p_order_id: orderId,
  });
});

it('fills the history limit with valid entries when a malformed entry appears first', async () => {
  mocks.read.mockResolvedValue({
    stage: 'activated',
    state: { booking: { status: 'ACTIVATED', loan_tenure: 3 }, schedule: [] },
  });
  const valid = Array.from(
    { length: OXYGEN_REPAYMENT_HISTORY_LIMIT + 1 },
    (_, index) => ({
      id: `bb3955b1-0571-49eb-919f-${String(index).padStart(12, '0')}`,
      recordedAt: '2026-11-20T12:00:00+00:00',
    })
  );
  mocks.rpc.mockResolvedValue({ data: [null, ...valid], error: null });
  const { plan } = await (await GET(request())).json();
  expect(plan.repaymentReceipts).toEqual(
    valid.slice(0, OXYGEN_REPAYMENT_HISTORY_LIMIT)
  );
});

it('keeps the schedule available when the acknowledgement lookup fails', async () => {
  const schedule = [{ period: 1, dueDate: [2026, 11, 27], amount: 55658 }];
  mocks.read.mockResolvedValue({
    stage: 'activated',
    state: { booking: { status: 'ACTIVATED', loan_tenure: 3 }, schedule },
  });
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private' } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  const { plan } = await response.json();
  expect(plan.schedule).toEqual(schedule);
  expect(plan.repaymentReceipts).toBeUndefined();
});

it('keeps acknowledgements visible when a saved calendar date is impossible', async () => {
  const receipt = {
    id: 'bb3955b1-0571-49eb-919f-6a6946fdb00b',
    recordedAt: '2026-11-20T12:00:00+00:00',
  };
  mocks.rpc.mockResolvedValue({ data: [receipt], error: null });
  mocks.read.mockResolvedValue({
    stage: 'activated',
    state: {
      booking: { status: 'ACTIVATED', loan_tenure: 3 },
      schedule: [{ period: 1, dueDate: [2026, 2, 30], amount: 55658 }],
    },
  });
  const { plan } = await (await GET(request())).json();
  expect(plan.schedule).toEqual([]);
  expect(plan.scheduleIncomplete).toBe(true);
  expect(plan.repaymentReceipts).toEqual([receipt]);
});

it('keeps unambiguous valid instalments and flags an incomplete schedule', async () => {
  const valid = { period: 1, dueDate: [2026, 11, 27], amount: 55658 };
  mocks.read.mockResolvedValue({
    stage: 'booked',
    state: {
      booking: { status: 'BOOKED', loan_tenure: 3 },
      schedule: [
        valid,
        { period: 2, dueDate: [2026, 11, 31], amount: 55658 },
        { period: 3, dueDate: [2027, 1, 27], amount: 55658 },
        { period: 3, dueDate: [2027, 1, 32], amount: 55000 },
        { period: 4, dueDate: [2027, 2, 27], amount: 55000 },
      ],
    },
  });
  const { plan } = await (await GET(request())).json();
  expect(plan.schedule).toEqual([valid]);
  expect(plan.scheduleIncomplete).toBe(true);
});

it('flags a discarded extra instalment even when every scheduled period is present', async () => {
  const first = { period: 1, dueDate: [2026, 11, 27], amount: 55658 };
  const second = { period: 2, dueDate: [2026, 12, 27], amount: 55000 };
  mocks.read.mockResolvedValue({
    stage: 'booked',
    state: {
      booking: { status: 'BOOKED', loan_tenure: 1 },
      schedule: [first, second],
    },
  });
  const { plan } = await (await GET(request())).json();
  expect(plan.schedule).toEqual([first]);
  expect(plan.scheduleIncomplete).toBe(true);
});

it('sorts known instalments around a gap and signals that the schedule is incomplete', async () => {
  const first = { period: 1, dueDate: [2026, 11, 27], amount: 55000 };
  const third = { period: 3, dueDate: [2027, 1, 27], amount: 55658 };
  mocks.read.mockResolvedValue({
    stage: 'booked',
    state: {
      booking: { status: 'BOOKED', loan_tenure: 3 },
      schedule: [third, first],
    },
  });
  const { plan } = await (await GET(request())).json();
  expect(plan.schedule).toEqual([first, third]);
  expect(plan.scheduleIncomplete).toBe(true);
});

it.each([0, 13])('rejects unsupported saved tenure %d', async (loan_tenure) => {
  mocks.read.mockResolvedValue({
    stage: 'activated',
    state: { booking: { status: 'ACTIVATED', loan_tenure }, schedule: [] },
  });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Plan unavailable' });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
