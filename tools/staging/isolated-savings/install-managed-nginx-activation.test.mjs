import assert from 'node:assert/strict';
import test from 'node:test';
import { runManagedNginxActivation } from './install-managed-nginx-activation.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

const source = `location /auth/v1/ {
    rewrite ^/auth/v1/(.*) /$1 break;
    proxy_pass http://172.23.0.3:9999;
}
location / {
  proxy_pass http://172.23.0.3:9999;
}
    location = /piggyvest/intake {
        proxy_pass http://127.0.0.1:4791;
    }
`;

function fixture(failure = '') {
  const input = routingFixture();
  const { host, containers, networks, restRoutes } = input.receipt;
  const calls = [];
  const actions = {
    assertGateway: async () => calls.push('gateway'),
    stage: () => {
      calls.push('stage');
      return { original: source };
    },
    activate: () => {
      calls.push('activate');
      if (failure === 'activate') throw new Error('secret');
    },
    test: () => {
      calls.push('test');
      if (
        failure === 'test' &&
        calls.filter((call) => call === 'test').length === 1
      )
        throw new Error('secret');
    },
    reload: () => {
      calls.push('reload');
      if (
        failure === 'reload' &&
        calls.filter((call) => call === 'reload').length === 1
      )
        throw new Error('secret');
    },
    restore: async () => calls.push('restore'),
    cleanup: () => {
      calls.push('cleanup');
      if (failure === 'cleanup') throw new Error('secret');
    },
    isActiveCandidate: async () => failure !== 'external-drift',
  };
  return {
    calls,
    actions,
    binding: {
      version: 1,
      identity: { host, containers, networks, restRoutes },
      reviewedAt: input.receipt.verifiedAt,
      leaseNotBefore: input.receipt.verifiedAt,
      leaseExpiresAt: new Date(input.now + 60_000).toISOString(),
    },
    input,
  };
}

test('restores the original configuration after a successful bounded rehearsal', async () => {
  const state = fixture();
  const output = await runManagedNginxActivation(
    { ...state, config: source },
    state.actions
  );
  assert.equal(output.leaseExpiresAt, state.binding.leaseExpiresAt);
  assert.deepEqual(state.calls, [
    'gateway',
    'stage',
    'activate',
    'test',
    'reload',
    'restore',
    'test',
    'reload',
    'cleanup',
  ]);
});

test('keeps only a successful explicitly persistent activation', async () => {
  const state = fixture();
  await runManagedNginxActivation(
    { ...state, config: source },
    state.actions,
    { persistent: true }
  );
  assert.deepEqual(state.calls, [
    'gateway',
    'stage',
    'activate',
    'test',
    'reload',
    'cleanup',
  ]);
});

for (const failure of ['activate', 'test', 'reload']) {
  test(`restores and verifies the original config when ${failure} fails`, async () => {
    const state = fixture(failure);
    await assert.rejects(
      runManagedNginxActivation({ ...state, config: source }, state.actions),
      /activation failed/
    );
    assert.deepEqual(state.calls, [
      'gateway',
      'stage',
      'activate',
      ...(failure === 'activate' ? [] : ['test']),
      ...(failure === 'reload' ? ['reload'] : []),
      ...(failure === 'activate' ? [] : ['restore', 'test', 'reload']),
      'cleanup',
    ]);
  });
}

test('does not overwrite an external vhost change after activation drift', async () => {
  const state = fixture('external-drift');
  const original = state.actions.test;
  state.actions.test = async () => {
    original();
    throw new Error('external change');
  };
  await assert.rejects(
    runManagedNginxActivation({ ...state, config: source }, state.actions),
    /owner review required/
  );
  assert.ok(!state.calls.includes('restore'));
  assert.equal(state.calls.at(-1), 'cleanup');
});

test('does not stage or alter Nginx when the exact PiggyVest intake route is absent', async () => {
  const state = fixture();
  await assert.rejects(
    runManagedNginxActivation(
      {
        ...state,
        config: source.replace(/location = \/piggyvest\/intake.*\n/, ''),
      },
      state.actions
    )
  );
  assert.deepEqual(state.calls, ['cleanup']);
});

test('redacts a cleanup failure after a successful activation', async () => {
  const state = fixture('cleanup');
  await assert.rejects(
    runManagedNginxActivation({ ...state, config: source }, state.actions),
    /cleanup requires owner review/
  );
});
