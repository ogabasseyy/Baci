import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runOxygenActivationTrial } from './activation-trial';

const trialReference = 'b75cd437-28af-4008-a1af-7e6810282833';
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([
      {
        reference: trialReference,
        workflowId: '52ab6696-762b-4e9f-8f99-a9d926a29b2c',
      },
      {
        reference: '1e65cf4b-4942-4ade-8149-e894687f6c40',
        workflowId: '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89',
      },
    ])
  );
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  'activated',
  'unpaid',
  'setup_incomplete',
  'malformed',
  'rejected',
  'timeout',
])('makes at most one activation attempt and retains its outcome (%s)', async (mode) => {
  const rpc = vi
    .fn()
    .mockImplementation(
      async (_name: string, args: Record<string, unknown>) => ({
        error: null,
        data:
          args.p_operation === 'enqueue' || args.p_operation === 'claim'
            ? {
                status: 'executing',
                reference: 'b75cd437-28af-4008-a1af-7e6810282833',
              }
            : { recorded: true },
      })
    );
  const request = vi.fn(async (operation: string) => {
    if (operation === 'payment')
      return Response.json({
        split_payment: { completed: mode !== 'unpaid' },
        repayment_setup: { completed: mode !== 'setup_incomplete' },
      });

    if (mode === 'timeout') throw new Error('timeout');
    return Response.json(
      mode === 'malformed'
        ? {}
        : mode === 'rejected'
          ? { message: 'Unable to activate' }
          : {
              loan_reference: 'b75cd437-28af-4008-a1af-7e6810282833',
              status: 'ACTIVATED',
              loan_amount: 297000,
            },
      { status: mode === 'rejected' ? 400 : 200 }
    );
  });
  await runOxygenActivationTrial(
    { rpc },
    { rpc },
    request,
    'a'.repeat(64),
    trialReference
  );
  const activations = request.mock.calls.filter(
    (call) => call[0] === 'activate'
  );
  expect(activations).toHaveLength(
    ['unpaid', 'setup_incomplete'].includes(mode) ? 0 : 1
  );
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_activation_trial',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({
        status:
          mode === 'activated'
            ? 'activated'
            : ['timeout', 'malformed', 'rejected'].includes(mode)
              ? 'indeterminate'
              : 'rejected',
      }),
    })
  );
  expect(
    rpc.mock.calls.filter((call) => call[1].p_operation === 'evidence').length
  ).toBeGreaterThan(0);
});
it('does not repeat a claimed or completed trial', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: null });
  const request = vi.fn();
  await runOxygenActivationTrial(
    { rpc },
    { rpc },
    request,
    'a'.repeat(64),
    trialReference
  );
  expect(request).not.toHaveBeenCalled();
});

it('binds the current activation claim, status request and provider response to the current reference', async () => {
  const reference = '1e65cf4b-4942-4ade-8149-e894687f6c40';
  const workflowId = '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89';
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data: args.p_operation === 'claim' ? { reference } : {},
  }));
  const request = vi.fn(async (operation: string) =>
    Response.json(
      operation === 'payment'
        ? {
            split_payment: { completed: true },
            repayment_setup: { completed: true },
          }
        : { loan_reference: reference, status: 'ACTIVATED' }
    )
  );
  await runOxygenActivationTrial(
    { rpc },
    { rpc },
    request,
    'a'.repeat(64),
    reference
  );
  expect(request).toHaveBeenCalledWith('activate', reference);
  expect(request).toHaveBeenCalledWith('payment', reference);
  for (const [, args] of rpc.mock.calls)
    expect(args.p_payload.workflowId).toBe(workflowId);
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_activation_trial',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({ status: 'activated' }),
    })
  );
});
it('does not send any provider request when the claim belongs to the previous booking', async () => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data:
      args.p_operation === 'claim'
        ? { reference: 'b75cd437-28af-4008-a1af-7e6810282833' }
        : {},
  }));
  const request = vi.fn();
  await runOxygenActivationTrial(
    { rpc },
    { rpc },
    request,
    'a'.repeat(64),
    '1e65cf4b-4942-4ade-8149-e894687f6c40'
  );
  expect(request).not.toHaveBeenCalled();
});

it('retains bounded payment and activation evidence without storing arbitrary provider bodies', async () => {
  const { createDecipheriv } = await import('node:crypto');
  const key = 'a'.repeat(64);
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data: args.p_operation === 'claim' ? { reference: trialReference } : {},
  }));
  const request = vi.fn(async (operation: string) =>
    Response.json(
      operation === 'payment'
        ? {
            split_payment: { completed: true, secret: 'sensitive-token' },
            repayment_setup: { completed: true },
            customer_email: 'buyer@example.com',
          }
        : {
            loan_reference: trialReference,
            status: 'ACTIVATED',
            loan_amount: 297000,
            identity: { bvn: 'sensitive-token' },
          }
    )
  );
  await runOxygenActivationTrial(
    { rpc },
    { rpc },
    request,
    key,
    trialReference
  );
  const captures = rpc.mock.calls
    .filter(([, args]) => args.p_operation === 'evidence')
    .map(([, args]) => {
      const c = args.p_payload.capture;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        Buffer.from(c.iv, 'base64')
      );
      decipher.setAAD(Buffer.from(c.aad, 'base64'));
      decipher.setAuthTag(Buffer.from(c.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(c.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8')
      );
    });
  expect(captures).toHaveLength(2);
  expect(JSON.stringify(captures)).not.toContain('sensitive-token');
  expect(JSON.stringify(captures)).not.toContain('buyer@example.com');
  expect(captures[0]).toMatchObject({
    operation: 'payment',
    httpStatus: 200,
    payment: { splitPaymentCompleted: true, repaymentSetupCompleted: true },
  });
  expect(captures[1]).toMatchObject({
    operation: 'activate',
    httpStatus: 200,
    activation: {
      loanReference: trialReference,
      status: 'ACTIVATED',
      terms: { loan_amount: 297000 },
    },
  });
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_activation_trial',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({ status: 'activated' }),
    })
  );
});

it.each([
  400, 409, 429, 500,
])('retains indeterminate status after a sent activation returns HTTP %i', async (status) => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data: args.p_operation === 'claim' ? { reference: trialReference } : {},
  }));
  const request = vi.fn(async (operation: string) =>
    operation === 'payment'
      ? Response.json({
          split_payment: { completed: true },
          repayment_setup: { completed: true },
        })
      : Response.json({ message: 'unconfirmed' }, { status })
  );
  await runOxygenActivationTrial(
    { rpc },
    { rpc },
    request,
    'a'.repeat(64),
    trialReference
  );
  expect(
    request.mock.calls.filter(([operation]) => operation === 'activate')
  ).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_activation_trial',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({ status: 'indeterminate' }),
    })
  );
});
