import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runGeneralOxygenActivation } from './general-activation';

const workflow = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reference = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const claim = {
  reference,
  attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  environment: 'staging',
};
it('does not request activation without the server gate or a durable claim', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: null });
  const request = vi.fn();
  await runGeneralOxygenActivation(
    { rpc },
    workflow,
    'staging',
    false,
    request,
    'a'.repeat(64)
  );
  expect(rpc).not.toHaveBeenCalled();
  await runGeneralOxygenActivation(
    { rpc },
    workflow,
    'staging',
    true,
    request,
    'a'.repeat(64)
  );
  expect(request).not.toHaveBeenCalled();
});
it('stores encrypted response evidence before projection and binds the response reference', async () => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data: args.p_operation === 'claim' ? claim : { recorded: true },
  }));
  const request = vi.fn().mockResolvedValue(
    Response.json({
      loan_reference: reference,
      status: 'ACTIVATED',
      private: 'secret',
    })
  );
  await runGeneralOxygenActivation(
    { rpc },
    workflow,
    'staging',
    true,
    request,
    'a'.repeat(64)
  );
  expect(request).toHaveBeenCalledWith(reference);
  const finish = rpc.mock.calls[1][1].p_payload;
  expect(finish.status).toBe('activated');
  expect(JSON.stringify(finish)).not.toContain('secret');
  expect(finish.ciphertext).toMatch(/^v1\./);
});
it.each([
  'timeout',
  'wrong-reference',
  'non-json',
  'http-error',
])('never reports activation on an uncertain %s response', async (mode) => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data: args.p_operation === 'claim' ? claim : { recorded: true },
  }));
  const request = vi.fn(async () => {
    if (mode === 'timeout') throw new Error('timeout');
    if (mode === 'non-json') return new Response('bad');
    if (mode === 'http-error') return Response.json({}, { status: 400 });
    return Response.json({ loan_reference: workflow, status: 'ACTIVATED' });
  });
  const run = runGeneralOxygenActivation(
    { rpc },
    workflow,
    'staging',
    true,
    request,
    'a'.repeat(64)
  );
  await expect(run).rejects.toThrow('Activation unconfirmed');
  expect(
    rpc.mock.calls.some(([, args]) => args.p_payload?.status === 'activated')
  ).toBe(false);
});

it.each([
  'executing',
  'indeterminate',
])('does not replay an existing %s claim', async (status) => {
  const rpc = vi.fn().mockResolvedValue({
    error: null,
    data: { status, environment: 'staging' },
  });
  const request = vi.fn();
  await expect(
    runGeneralOxygenActivation(
      { rpc },
      workflow,
      'staging',
      true,
      request,
      'a'.repeat(64)
    )
  ).rejects.toThrow('Activation unconfirmed');
  expect(request).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('reconciles durable activation without repeating the provider request', async () => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data:
      args.p_operation === 'claim'
        ? { status: 'activated', environment: 'staging' }
        : { orderConfirmed: true },
  }));
  const request = vi.fn();
  await runGeneralOxygenActivation(
    { rpc },
    workflow,
    'staging',
    true,
    request,
    'a'.repeat(64)
  );
  expect(request).not.toHaveBeenCalled();
  expect(rpc.mock.calls[1][1].p_operation).toBe('reconcile');
});
it('does not project when evidence persistence fails', async () => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: args.p_operation === 'finish' ? {} : null,
    data: args.p_operation === 'claim' ? claim : null,
  }));
  await expect(
    runGeneralOxygenActivation(
      { rpc },
      workflow,
      'staging',
      true,
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ loan_reference: reference, status: 'ACTIVATED' })
        ),
      'a'.repeat(64)
    )
  ).rejects.toThrow('Activation unconfirmed');
  expect(rpc.mock.calls.map(([, args]) => args.p_operation)).toEqual([
    'claim',
    'finish',
  ]);
});

it('never sends an activation to a different environment from the durable claim', async () => {
  const rpc = vi.fn().mockResolvedValue({
    error: null,
    data: { ...claim, environment: 'production' },
  });
  const request = vi.fn();
  await expect(
    runGeneralOxygenActivation(
      { rpc },
      workflow,
      'staging',
      true,
      request,
      'a'.repeat(64)
    )
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('does not reconcile an existing activation from a different environment', async () => {
  const rpc = vi.fn().mockResolvedValue({
    error: null,
    data: { status: 'activated', environment: 'production' },
  });
  const request = vi.fn();
  await expect(
    runGeneralOxygenActivation(
      { rpc },
      workflow,
      'staging',
      true,
      request,
      'a'.repeat(64)
    )
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});
