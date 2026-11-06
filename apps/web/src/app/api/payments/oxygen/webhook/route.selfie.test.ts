import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  connect: vi.fn(),
  configuration: vi.fn(),
  worker: vi.fn(),
  rpc: vi.fn(),
  after: vi.fn(),
}));
vi.mock('server-only', () => ({}));
type NextServerModule = typeof import('next/server');

vi.mock('next/server', async (original) => ({
  ...(await original<NextServerModule>()),
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

it.each([
  ['accepted', 'DONE'],
  ['duplicate', 'DONE'],
  ['accepted', 'PROCESSING'],
] as const)('wakes a pending %s selfie callback only for its supplied application', async (acceptance, selfieStatus) => {
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
  const call = vi
    .fn()
    .mockResolvedValue({ ...kyc, selfie_status: selfieStatus });
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
      if (args.p_operation === 'accept')
        data = { result: acceptance, wakeNeeded: true };
      if (args.p_operation === 'pending')
        data = [
          {
            id: callback,
            retryKey: callback,
            kind: 'selfie',
            workflowIds: [workflow],
          },
        ];
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
      webhook_type: 'selfie_status_update',
      phone_number: '08000000000',
      loan_request_reference: application,
      selfie: true,
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
      p_payload: { kind: 'selfie', applicationReference: application },
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
      p_operation: selfieStatus === 'DONE' ? 'complete' : 'defer',
      p_payload: { id: callback, retryKey: callback },
    })
  );
});
