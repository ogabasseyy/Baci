import { createOxygenClient } from './client';

const id = '11111111-1111-4111-8111-111111111111';
const profile = {
  apiOrigin: 'https://staging.example',
  authOrigin: 'https://auth.example',
  merchantId: id,
  merchantSlug: 'shop',
};
const session = async () => ({ access_token: 'test', user: { id } });
it('opts into and preserves the safe eligibility failure reason on reads and actions', async () => {
  const snapshot = {
    workflowId: id,
    version: 1,
    stage: 'eligibility_required',
    environment: 'staging',
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    state: {
      eligibilityStatus: 'failed',
      eligibilityFailureReason: 'financial_details_mismatch',
    },
  };
  const transport = jest
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(snapshot)));
  const client = createOxygenClient({
    profile,
    getSession: session,
    fetch: transport,
  });
  expect((await client.snapshot(id)).state.eligibilityFailureReason).toBe(
    'financial_details_mismatch'
  );
  expect(
    (
      await client.action({
        workflowId: id,
        version: 1,
        idempotencyKey: id,
        command: { action: 'refresh_eligibility' },
      })
    ).state.eligibilityFailureReason
  ).toBe('financial_details_mismatch');
  for (const call of transport.mock.calls) {
    expect(call[1].headers['x-oxygen-eligibility-reason']).toBe('1');
  }
});
it.each([
  401, 409, 429,
])('never retries HTTP %i or retains submitted body in errors', async (status) => {
  const transport = jest
    .fn()
    .mockResolvedValue(new Response('{"error":"secret"}', { status }));
  const client = createOxygenClient({
    profile,
    getSession: session,
    fetch: transport,
  });
  await expect(
    client.action({
      workflowId: id,
      version: 1,
      idempotencyKey: id,
      command: { action: 'validate_customer', otp: '123456' },
    })
  ).rejects.toMatchObject({
    status,
    dispatchState: status === 409 ? 'unknown' : 'not_dispatched',
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const init = transport.mock.calls[0][1];
  expect(init.credentials).toBe('omit');
  expect(init.redirect).toBe('error');
});
it('reads disabled owned capabilities but checks pins', async () => {
  const transport = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        schemaVersion: 1,
        environment: 'staging',
        authOrigin: profile.authOrigin,
        merchant: { id, slug: 'shop' },
        mobileEnabled: false,
        reason: 'Disabled',
        hostedOrigins: [],
        selfieOrigins: [],
      })
    )
  );
  expect(
    (
      await createOxygenClient({
        profile,
        getSession: session,
        fetch: transport,
      }).capabilities()
    ).mobileEnabled
  ).toBe(false);
  // Native whatwg-fetch adds an `_` query parameter for cache: 'no-store'.
  // Strict Oxygen GET schemas must receive only their declared parameters.
  const [url, init] = transport.mock.calls[0];
  expect(new URL(url).search).toBe('?merchantSlug=shop');
  expect(init.cache).toBeUndefined();
  expect(init.headers['Cache-Control']).toBe('no-store');
});
it('validates draft write version-only response and rejects a changed auth user', async () => {
  const transport = jest.fn().mockResolvedValue(new Response('{"version":2}'));
  const client = createOxygenClient({
    profile,
    getSession: session,
    fetch: transport,
    expectedUserId: id,
  });
  expect(
    await client.draft.write({
      workflowId: id,
      version: 1,
      idempotencyKey: id,
      draft: { step: 0, fields: {} },
    })
  ).toEqual({ version: 2 });
  const changed = createOxygenClient({
    profile,
    getSession: session,
    fetch: transport,
    expectedUserId: '22222222-2222-4222-8222-222222222222',
  });
  await expect(changed.snapshot(id)).rejects.toMatchObject({ code: 'auth' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('requires valid transient signature bytes and never dispatches a missing file', async () => {
  const transport = jest.fn();
  const client = createOxygenClient({
    profile,
    getSession: session,
    fetch: transport,
  });
  await expect(
    client.action({
      workflowId: id,
      version: 1,
      idempotencyKey: id,
      command: { action: 'approve_booking', otp: '123456', accepted: true },
    })
  ).rejects.toMatchObject({ code: 'invalid' });
  expect(transport).not.toHaveBeenCalled();
});
