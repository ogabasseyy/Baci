import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
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
    supabase: { from: mocks.from },
  });
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
  mocks.read.mockResolvedValue({ stage: 'activated', state });
  expect((await (await GET(request())).json()).plan.activationConfirmed).toBe(
    true
  );
});
