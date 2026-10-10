const assert = require('node:assert/strict');
const test = require('node:test');
const probe = require('./claim_probe.cjs');

const tokens = {
  oldNative: 'synthetic-old-native',
  oldInterest: 'synthetic-old-interest',
  new: 'synthetic-new',
};

function transport(calls, override) {
  return (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('piggyvest_staging_system_id')) {
      return { status: 200, text: () => '"7686901100561231906"' };
    }
    const fresh = options.headers.Authorization === 'Bearer synthetic-new';
    return {
      status: override?.status ?? (fresh ? 400 : 403),
      text: () =>
        JSON.stringify({
          code: fresh ? '22023' : '42501',
          message: fresh ? 'Invalid claim bounds' : 'Replay claimant refused',
          details: null,
          hint: null,
          ...override?.body,
        }),
    };
  };
}

test('uses only physical identity and null-bound nonclaiming probes', async () => {
  const calls = [];
  const report = await probe(tokens, transport(calls));
  assert.equal(calls.length, 6);
  assert.deepEqual(Object.keys(report), ['oldNative', 'oldInterest', 'new']);
  for (const call of calls.filter((call) =>
    call.url.endsWith('claim_piggyvest_staging_receipts')
  )) {
    assert.deepEqual(JSON.parse(call.options.body), {
      p_limit: null,
      p_lease_seconds: null,
    });
    assert.equal(call.options.redirect, 'error');
  }
  for (const token of Object.values(tokens))
    assert.equal(JSON.stringify(report).includes(token), false);
});

test('refuses old tokens accepted by an unfenced server', async () => {
  await assert.rejects(
    probe(tokens, transport([], { status: 400 })),
    /claim_fence_probe_refused/
  );
});

test('refuses an unexpected response without incorporating sensitive details', async () => {
  await assert.rejects(
    probe(
      tokens,
      transport([], { body: { details: 'synthetic-private-detail' } })
    ),
    (error) => {
      assert.equal(error.message, 'claim_fence_probe_refused');
      return true;
    }
  );
});

test('refuses a different physical database before any claim probe', async () => {
  const calls = [];
  await assert.rejects(
    probe(tokens, (url) => {
      calls.push(url);
      return { status: 200, text: () => '"wrong-physical-system"' };
    }),
    /claim_fence_probe_refused/
  );
  assert.equal(calls.length, 1);
});

test('refuses additional credential profiles', async () => {
  await assert.rejects(
    probe({ ...tokens, extra: 'synthetic' }),
    /claim_fence_probe_refused/
  );
});

test('rejects conflicting duplicate response keys before reconstructing or exposing the body', async () => {
  await assert.rejects(
    probe(tokens, (url) =>
      url.endsWith('piggyvest_staging_system_id')
        ? { status: 200, text: () => '"7686901100561231906"' }
        : {
            status: 403,
            text: () =>
              '{"code":"synthetic-private-conflict","code":"42501",' +
              '"message":"Replay claimant refused","details":null,"hint":null}',
          }
    ),
    /claim_fence_probe_refused/
  );
});

test('rejects escaped duplicate keys without exposing discarded conflicting values', async () => {
  await assert.rejects(
    probe(tokens, (url) =>
      url.endsWith('piggyvest_staging_system_id')
        ? { status: 200, text: () => '"7686901100561231906"' }
        : {
            status: 403,
            text: () =>
              '{"\\u0063ode":"synthetic-private-conflict","code":"42501",' +
              '"message":"Replay claimant refused","details":null,"hint":null}',
          }
    ),
    /claim_fence_probe_refused/
  );
});
