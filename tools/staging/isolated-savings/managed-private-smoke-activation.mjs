import {
  requireValue,
  runtime,
  socketPath,
  unit,
} from './managed-private-smoke-actions.mjs';

export async function runSmokeActivation(ctx) {
  const {
    actions,
    binding,
    check,
    clockStart,
    evidence,
    gid,
    lease,
    onReady,
    retainOnReady,
    state,
    stopped,
    uid,
  } = ctx;
    ctx.stage = 'exclusive-evidence';
    await actions.create('binding', binding, gid, ctx.owned);
    await actions.create('startup-evidence', evidence, gid, ctx.owned);
    requireValue(stopped(await state()) && (await actions.absent(runtime)));
    check();
    ctx.stage = 'start-unit';
    await actions.run('/usr/bin/systemctl', ['start', '--no-block', unit]);
    ctx.started = true;
    let current = await actions.state();
    const startDeadline = actions.monotonic() + 5000;
    while (!current.InvocationID && actions.monotonic() < startDeadline) {
      await actions.pause(50);
      current = await actions.state();
    }
    ctx.invocation = current.InvocationID;
    requireValue(/^[a-f0-9]{32}$/.test(ctx.invocation));
    ctx.stage = 'socket-ready';
    const deadline = actions.monotonic() + 10000;
    while (true) {
      check();
      current = await state();
      requireValue(
        current.InvocationID === ctx.invocation &&
          ['activating', 'active'].includes(current.ActiveState)
      );
      try {
        await actions.socket(uid, gid);
        break;
      } catch {
        requireValue(actions.monotonic() < deadline);
        await actions.pause(100);
      }
    }
    ctx.stage = 'private-get';
    requireValue(
      (await actions.get({ socketPath, path: '/auth/v1/user' })) === 401
    );
    requireValue(
      (await actions.get({ socketPath, path: '/auth/v1/admin/users' })) === 403
    );
    const noNewPrivs = await actions.noNewPrivs(current.MainPID);
    requireValue((await state()).MainPID === current.MainPID);
    actions.report({
      stage: 'private-smoke',
      mainPID: Number(current.MainPID),
      noNewPrivs,
      leaseSeconds: lease.duration / 1000,
    });
    ctx.stage = 'nginx-activation';
    await onReady({
      binding,
      evidence,
      leaseExpiresAt: binding.leaseExpiresAt,
    });
    if (retainOnReady) {
      ctx.retained = true;
      actions.report({
        stage: 'ctx.retained-activation',
        leaseSeconds: lease.duration / 1000,
      });
      return;
    }
    ctx.stage = 'lease-withdrawal';
    while (actions.monotonic() - clockStart <= 70000) {
      check();
      current = await state();
      requireValue(
        !current.InvocationID || current.InvocationID === ctx.invocation
      );
      if (stopped(current) && (await actions.absent(socketPath))) break;
      await actions.pause(250);
    }
    requireValue(
      actions.monotonic() - clockStart >= 60000 &&
        stopped(current) &&
        (await actions.absent(socketPath))
    );
    actions.report({
      stage: 'lease-withdrawn',
      state: current.ActiveState,
      socketAbsent: true,
      restarted: false,
    });
}
