import assert from 'node:assert/strict';
import test from 'node:test';
import { routingFixture } from './private-routing.test-support.mjs';
import { supervisePrivateRouting } from './private-routing-supervisor.mjs';

function harness() {
  const fixture = routingFixture();
  const controller = new AbortController();
  const calls = [];
  let parent = true;
  const actions = {
    now: () => fixture.now,
    parentAlive: () => parent,
    inventory: () => {
      calls.push('inventory');
      return structuredClone(fixture.inventory);
    },
    prepare: () => {
      calls.push('prepare');
    },
    start: () => {
      calls.push('start');
      return { alive: () => true, exited: new Promise(() => undefined) };
    },
    pause: () => {
      controller.abort();
    },
    stop: () => {
      calls.push('stop');
    },
    cleanup: () => {
      calls.push('cleanup');
    },
  };
  return {
    fixture,
    controller,
    calls,
    actions,
    parentExit: () => {
      parent = false;
    },
  };
}

test('maintenance-stopped live containers refuse ingress before parser or child startup', async () => {
  const state = harness();
  const input = structuredClone(state.fixture);
  state.fixture.inventory.containers[0].State.Running = false;
  await assert.rejects(
    supervisePrivateRouting(input, state.actions, state.controller.signal)
  );
  assert.deepEqual(state.calls, ['inventory', 'cleanup']);
});

test('stops exactly the owned child and cleans up on operator abort', async () => {
  const state = harness();
  await supervisePrivateRouting(
    state.fixture,
    state.actions,
    state.controller.signal
  );
  assert.deepEqual(state.calls, [
    'inventory',
    'prepare',
    'inventory',
    'start',
    'inventory',
    'stop',
    'cleanup',
  ]);
});

test('withdraws for unhealthy, recreated or disconnected containers and networks without restarting', async () => {
  for (const mutate of [
    (fixture) => {
      fixture.inventory.containers[0].State.Health.Status = 'unhealthy';
    },
    (fixture) => {
      fixture.inventory.containers[0].Id = 'a'.repeat(64);
    },
    (fixture) => {
      fixture.inventory.networks[0].Id = 'b'.repeat(64);
    },
    (fixture) => {
      fixture.inventory.containers[0].NetworkSettings.Networks = {};
    },
    (fixture) => {
      fixture.now += 300001;
    },
  ]) {
    const state = harness();
    state.actions.pause = () => mutate(state.fixture);
    await assert.rejects(
      supervisePrivateRouting(
        state.fixture,
        state.actions,
        state.controller.signal
      )
    );
    assert.deepEqual(state.calls.slice(-2), ['stop', 'cleanup']);
    assert.equal(state.calls.filter((call) => call === 'start').length, 1);
  }
});

test('withdraws if Docker inventory errors or times out', async () => {
  const state = harness();
  state.actions.pause = () => {
    state.actions.inventory = () => {
      throw new Error('timeout');
    };
  };
  await assert.rejects(
    supervisePrivateRouting(
      state.fixture,
      state.actions,
      state.controller.signal
    )
  );
  assert.deepEqual(state.calls.slice(-2), ['stop', 'cleanup']);
});

test('withdraws when supervisor parent exits', async () => {
  const state = harness();
  state.actions.pause = () => state.parentExit();
  await supervisePrivateRouting(
    state.fixture,
    state.actions,
    state.controller.signal
  );
  assert.deepEqual(state.calls.slice(-2), ['stop', 'cleanup']);
});

test('parser failure and health changes during preparation cannot start child', async () => {
  for (const failParser of [true, false]) {
    const state = harness();
    state.actions.prepare = () => {
      if (failParser) throw new Error('parser failed');
      state.fixture.inventory.containers[1].State.Running = false;
    };
    await assert.rejects(
      supervisePrivateRouting(
        state.fixture,
        state.actions,
        state.controller.signal
      )
    );
    assert.equal(state.calls.includes('start'), false);
    assert.equal(state.calls.at(-1), 'cleanup');
  }
});

test('unexpected owned child exit terminates supervision without respawn', async () => {
  const state = harness();
  state.actions.start = () => ({
    alive: () => true,
    exited: Promise.resolve(),
  });
  state.actions.pause = () => new Promise(() => undefined);
  await assert.rejects(
    supervisePrivateRouting(
      state.fixture,
      state.actions,
      state.controller.signal
    )
  );
  assert.deepEqual(state.calls.slice(-2), ['stop', 'cleanup']);
});
