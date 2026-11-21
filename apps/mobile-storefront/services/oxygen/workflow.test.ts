import { OxygenClientError } from './errors';
import { id, scope, setup, snapshot } from './workflow.test-support';

it('durable write failure prevents dispatch', async () => {
  const { storage, controller, client } = setup();
  storage.setItem.mockRejectedValueOnce(new Error('disk'));
  await controller.initialize();
  expect(client.createOrResume).not.toHaveBeenCalled();
});
it('reads authenticated hosted progress without re-fetching verified capabilities', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  await controller.pollHostedStatus();
  await controller.pollHostedStatus();
  expect(client.capabilities).toHaveBeenCalledTimes(1);
  expect(client.snapshot.mock.calls).toEqual([[id], [id], [id]]);
  expect(controller.getState().capabilities).not.toBeNull();
});
it('does not poll hosted status until capabilities have been verified', async () => {
  const { controller, client } = setup();
  client.capabilities.mockRejectedValueOnce(new OxygenClientError('transport'));
  await controller.initialize();
  await controller.pollHostedStatus();
  expect(client.snapshot).toHaveBeenCalledTimes(1);
  expect(controller.getState().error?.code).toBe('recovery');
});
it('lost create response resumes same owned order', async () => {
  const { controller, client } = setup();
  client.createOrResume.mockRejectedValueOnce(new Error('lost'));
  await controller.initialize();
  expect(controller.getState().snapshot).toBeNull();
  await controller.refresh();
  expect(client.createOrResume.mock.calls).toEqual([[id], [id]]);
  expect(controller.getState().snapshot?.workflowId).toBe(id);
  expect(controller.getState().error).toBeNull();
  expect(client.action).not.toHaveBeenCalled();
});
it('serializes duplicate handlers and finishes journal before dispatch', async () => {
  const { controller, client, storage } = setup();
  await controller.initialize();
  let resolve: () => void = () => {};
  storage.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  const first = controller.execute({
    action: 'validate_customer',
    otp: '123456',
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  expect(client.action).not.toHaveBeenCalled();
  resolve();
  await first;
  expect(client.action).toHaveBeenCalledTimes(1);
});
it('unmatched local journal cannot authorize replay of uncertain approval', async () => {
  const { controller, client, journal } = setup();
  await controller.initialize();
  await journal.write({
    scope,
    workflowId: id,
    action: 'approve_booking',
    version: 1,
    key: id,
    time: 1,
  });
  client.snapshot.mockResolvedValue({
    ...snapshot,
    pending: {
      action: 'approve_booking',
      status: 'indeterminate',
      idempotencyKey: id,
    },
  });
  await controller.recover();
  expect(client.action).not.toHaveBeenCalled();
});
it('canonical queued recovery reuses server key without local authority', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  client.snapshot.mockResolvedValue({
    ...snapshot,
    stage: 'kyc_required',
    state: { applicationReference: id },
    pending: { action: 'refresh_kyc', status: 'executing', idempotencyKey: id },
  });
  await controller.recover();
  expect(client.action).toHaveBeenCalledWith(
    expect.objectContaining({
      idempotencyKey: id,
      command: { action: 'refresh_kyc' },
    })
  );
});
it('disposal suppresses stale network completion', async () => {
  const { controller, client } = setup();
  let resolve: (value: unknown) => void = () => {};
  client.createOrResume.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const work = controller.initialize();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  controller.dispose();
  resolve({ id, version: 1 });
  await work;
  expect(controller.getState().snapshot).toBeNull();
});
it('does not create a fresh mutation key while a lost dispatch is unconfirmed', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  client.action.mockRejectedValue(new Error('lost'));
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  expect(client.action).toHaveBeenCalledTimes(1);
});
it('a local journal alone cannot authorize a recovery POST', async () => {
  const { controller, client, journal } = setup();
  await journal.write({
    scope,
    workflowId: id,
    action: 'refresh_kyc',
    version: 1,
    key: id,
    time: 1,
  });
  await controller.recover();
  expect(client.snapshot).not.toHaveBeenCalled();
  expect(client.action).not.toHaveBeenCalled();
});
it('queued booking restores server numeric terms using the same key', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  client.snapshot.mockResolvedValue({
    ...snapshot,
    stage: 'plan_required',
    pending: {
      action: 'book',
      status: 'queued',
      idempotencyKey: id,
      bookingTerms: { equityPercentage: 25, tenure: 3 },
    },
  });
  await controller.recover();
  expect(client.action).toHaveBeenCalledWith(
    expect.objectContaining({
      command: { action: 'book', equityPercentage: 25, tenure: 3 },
      idempotencyKey: id,
    })
  );
});
it('rejects an approval captured against another booking version/reference', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  client.snapshot.mockResolvedValue({
    ...snapshot,
    stage: 'approval_required',
    version: 2,
    state: { bookingReference: id },
  });
  await controller.execute(
    { action: 'approve_booking', otp: '123456', accepted: true },
    {
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      name: 'signature.png',
      type: 'image/png',
    },
    { version: 1, bookingReference: id }
  );
  expect(client.action).not.toHaveBeenCalled();
});

it('requires a usable server approval window before dispatch', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  client.snapshot.mockResolvedValue({
    ...snapshot,
    stage: 'approval_required',
    state: { bookingReference: id },
  });
  await controller.execute(
    { action: 'approve_booking', otp: '123456', accepted: true },
    {
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      name: 'signature.png',
      type: 'image/png',
    },
    { version: 1, bookingReference: id }
  );
  expect(client.approvalWindow).toHaveBeenCalledWith(id);
  expect(client.action).not.toHaveBeenCalled();
});
it.each([
  401, 429,
])('permits explicit retry after definite preclaim %i without automatic replay', async (status) => {
  const { controller, client } = setup();
  await controller.initialize();
  client.action.mockRejectedValueOnce(
    new OxygenClientError(
      status === 401 ? 'auth' : 'http',
      status,
      'not_dispatched'
    )
  );
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  expect(client.action).toHaveBeenCalledTimes(1);
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  expect(client.action).toHaveBeenCalledTimes(2);
});
it('invalid proof is rejected before journaling and does not block corrected input', async () => {
  const { controller, client, storage } = setup();
  await controller.initialize();
  const writes = storage.setItem.mock.calls.length;
  await controller.execute({
    action: 'submit_address',
    state: 'Lagos',
    lga: 'Ikeja',
    city: 'Ikeja',
    street: 'Street',
    landmark: 'Market',
    house_number: '1',
  });
  expect(storage.setItem).toHaveBeenCalledTimes(writes);
  expect(client.action).not.toHaveBeenCalled();
  await controller.execute({ action: 'refresh_kyc' });
  expect(client.action).toHaveBeenCalledTimes(1);
});
it('409 keeps the uncertainty fence even with no pending canonical row', async () => {
  const { controller, client } = setup();
  await controller.initialize();
  client.action.mockRejectedValueOnce(new OxygenClientError('http', 409));
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  await controller.execute({ action: 'validate_customer', otp: '123456' });
  expect(client.action).toHaveBeenCalledTimes(1);
});
it('keeps owned first-party status visible during capability outage and blocks provider actions', async () => {
  const { controller, client } = setup();
  client.capabilities.mockRejectedValue(new OxygenClientError('http', 503));
  await controller.initialize();
  expect(controller.getState().snapshot?.workflowId).toBe(id);
  await controller.execute({ action: 'refresh_kyc' });
  expect(client.action).not.toHaveBeenCalled();
  client.capabilities.mockResolvedValue({ mobileEnabled: false });
  await controller.refresh();
  await controller.execute({ action: 'refresh_kyc' });
  expect(client.action).toHaveBeenCalledTimes(1);
});
it('never falls back past mismatched capability pins', async () => {
  const { controller, client } = setup();
  client.capabilities.mockRejectedValue(new OxygenClientError('scope'));
  await controller.initialize();
  expect(client.createOrResume).not.toHaveBeenCalled();
  expect(client.snapshot).not.toHaveBeenCalled();
});

it.each([
  ['production', id],
  ['production', null],
  ['staging', id],
  ['staging', null],
] as const)('reads only an existing %s workflow (%s) when initiation is disabled', async (environment, savedId) => {
  const findSaved = jest.fn().mockResolvedValue(savedId);
  const { controller, client, storage } = setup({
    environment,
    findSaved,
  });
  client.capabilities.mockResolvedValue({ mobileEnabled: false });
  client.snapshot.mockResolvedValue({ ...snapshot, environment });

  await controller.initialize();

  expect(findSaved).toHaveBeenCalledWith(id);
  expect(client.createOrResume).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
  if (savedId) {
    expect(client.snapshot).toHaveBeenCalledWith(savedId);
    expect(controller.getState().snapshot?.workflowId).toBe(savedId);
  } else {
    expect(client.snapshot).not.toHaveBeenCalled();
    expect(controller.getState().error).toBeTruthy();
  }
});
