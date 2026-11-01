import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  connect: vi.fn(),
  configuration: vi.fn(),
  worker: vi.fn(),
  rpc: vi.fn(),
  after: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: m.after,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
  oxygenRuntimeCallbackConfiguration: m.configuration,
}));

import { POST } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  m.configuration.mockReturnValue({
    partnerReference: 'partner',
    auth: {
      mode: 'API_KEY',
      apiKey: 'synthetic-key',
      apiSecret: 'synthetic-secret',
    },
  });
  m.worker.mockResolvedValue({ rpc: m.rpc });
  m.rpc.mockResolvedValue({ data: { result: 'accepted' }, error: null });
  m.connect.mockReturnValue({
    partnerReference: 'partner',
    hosts: new Set(),
    provider: { call: vi.fn() },
    worker: m.worker,
  });
});
const request = (authenticated: boolean) =>
  new Request('https://local/api/payments/oxygen/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated
        ? { api_key: 'synthetic-key', api_secret: 'synthetic-secret' }
        : {}),
    },
    body: JSON.stringify({
      webhook_type: 'address_status_update',
      phone_number: '2348012345678',
      address_validated: true,
    }),
  });
it('authenticates callbacks before touching the worker account', async () => {
  expect((await POST(request(false))).status).toBe(401);
  expect(m.worker).not.toHaveBeenCalled();
});
it('acknowledges only a durable event and schedules reconciliation afterwards', async () => {
  expect((await POST(request(true))).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith('oxygen_callback', {
    p_operation: 'accept',
    p_partner: 'partner',
    p_payload: {
      kind: 'address',
      phoneNumber: '2348012345678',
      action: 'reconcile_kyc',
    },
  });
  expect(m.after).toHaveBeenCalledTimes(1);
});
it('does not acknowledge failed persistence or schedule provider work', async () => {
  m.rpc.mockResolvedValue({ error: { code: 'unavailable' }, data: null });
  expect((await POST(request(true))).status).toBe(503);
  expect(m.after).not.toHaveBeenCalled();
});

it('dispatches a durably accepted transaction to the exact callback payment recovery binding', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const retry = '60000000-0000-4000-8000-000000000002';
  const reference = '70000000-0000-4000-8000-000000000001';
  const payment = vi.fn().mockResolvedValue(undefined);
  m.connect.mockReturnValue({
    partnerReference: 'partner',
    hosts: new Set(),
    provider: { call: vi.fn() },
    worker: m.worker,
    reconcilePaymentCallback: payment,
  });
  m.rpc.mockImplementation(
    async (_name: string, args: Record<string, unknown>) => ({
      error: null,
      data:
        args.p_operation === 'pending'
          ? [{ id, kind: 'transaction', retryKey: retry, workflowIds: [id] }]
          : { result: 'accepted', recorded: true },
    })
  );
  const incoming = new Request('https://local/api/payments/oxygen/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      api_key: 'synthetic-key',
      api_secret: 'synthetic-secret',
    },
    body: JSON.stringify({
      phone_number: '08000000000',
      transaction_reference: 'synthetic-transaction',
      amount_deducted: '100.00',
      amount_sent: '100.00',
      loan_request_reference: reference,
    }),
  });
  expect((await POST(incoming)).status).toBe(200);
  expect(payment).not.toHaveBeenCalled();
  await m.after.mock.calls[0][0]();
  expect(payment).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ rpc: m.rpc }),
    id,
    id,
    retry
  );
});

it('processes an address callback only for its supplied application, without draining old transaction jobs', async () => {
  const workflow = '60000000-0000-4000-8000-000000000011';
  const application = '60000000-0000-4000-8000-000000000012';
  const callback = '60000000-0000-4000-8000-000000000013';
  const command = '60000000-0000-4000-8000-000000000014';
  const kyc = {
    phone_status: 'DONE',
    bvn_status: 'DONE',
    nin_status: 'DONE',
    bank_status: 'DONE',
    selfie_status: 'DONE',
    address_status: 'DONE',
  };
  const state = {
    applicationReference: application,
    bookingReference: application,
    validated: true,
    eligible: true,
    kyc,
  };
  const call = vi.fn().mockResolvedValue(kyc);
  const payment = vi.fn();
  m.connect.mockReturnValue({
    partnerReference: 'partner',
    hosts: new Set(),
    provider: { call },
    worker: m.worker,
    reconcilePaymentCallback: payment,
  });
  m.rpc.mockImplementation(
    async (_name: string, args: Record<string, unknown>) => {
      let data: unknown = { recorded: true };
      if (args.p_operation === 'accept') data = { result: 'accepted' };
      if (args.p_operation === 'pending')
        data = [{ id: callback, kind: 'address', workflowIds: [workflow] }];
      if (args.p_operation === 'worker_status')
        data = {
          workflowId: workflow,
          stage: 'approval_required',
          version: 2,
          environment: 'staging',
          executionEnabled: true,
          state,
          approvalOtpReady: false,
          activationEnabled: false,
          settlementEnabled: false,
        };
      if (args.p_operation === 'reconcile')
        data = { commandId: command, status: 'queued' };
      if (args.p_operation === 'claim')
        data = {
          context: {
            workflowId: workflow,
            orderId: workflow,
            stage: 'approval_required',
            version: 2,
            environment: 'staging',
            partnerReference: 'partner',
            merchantReference: null,
            productAmount: 198000,
            orderPhone: '08000000000',
            productName: 'Fixture',
            address: 'Test Street',
            state,
          },
        };
      return { data, error: null };
    }
  );
  const incoming = new Request('https://local/api/payments/oxygen/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      api_key: 'synthetic-key',
      api_secret: 'synthetic-secret',
    },
    body: JSON.stringify({
      webhook_type: 'address_status_update',
      phone_number: '08000000000',
      loan_request_reference: application,
      address_validated: true,
    }),
  });
  expect((await POST(incoming)).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    'oxygen_callback',
    expect.objectContaining({
      p_operation: 'accept',
      p_payload: expect.objectContaining({ applicationReference: application }),
    })
  );
  await m.after.mock.calls[0][0]();
  expect(m.rpc).toHaveBeenCalledWith(
    'oxygen_callback',
    expect.objectContaining({
      p_operation: 'pending',
      p_payload: { kind: 'address', applicationReference: application },
    })
  );
  expect(call).toHaveBeenCalledExactlyOnceWith('kyc', {
    loan_request_reference: application,
    partner_reference: 'partner',
  });
  expect(payment).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledWith(
    'oxygen_callback',
    expect.objectContaining({
      p_operation: 'complete',
      p_payload: { id: callback },
    })
  );
});
