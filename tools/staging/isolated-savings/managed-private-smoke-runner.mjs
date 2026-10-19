import { nativeActions, requireValue, stopped, unit } from './managed-private-smoke-actions.mjs';
import { runSmokeActivation } from './managed-private-smoke-activation.mjs';
import { runSmokePreflight } from './managed-private-smoke-preflight.mjs';

export { MAX_PRIVATE_SMOKE_LEASE_MS } from './managed-private-smoke-actions.mjs';

export async function runPrivateSmoke(
  { identity, uid, gid },
  actions = nativeActions(),
  onReady = () => Promise.resolve(),
  {
    leaseMs = 60000,
    retainOnReady = false,
    routeContract = 'product-only',
    leaseExpiresAt,
  } = {}
) {
  const ctx = {
    actions,
    identity,
    uid,
    gid,
    onReady,
    leaseMs,
    retainOnReady,
    routeContract,
    leaseExpiresAt,
    stage: 'preflight',
    invocation: undefined,
    started: false,
    retained: false,
    owned: [],
  };
  let interrupted = false;
  const terminate = () => {
    interrupted = true;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, terminate);
  const check = () => requireValue(!interrupted);
  const state = async () => {
    const value = await actions.state();
    requireValue(
      value.LoadState === 'loaded' &&
        value.Restart === 'no' &&
        value.NRestarts === '0'
    );
    requireValue(
      value.FragmentPath === `/etc/systemd/system/${unit}` &&
        value.DropInPaths === '' &&
        value.NeedDaemonReload === 'no'
    );
    requireValue(['disabled', 'static'].includes(value.UnitFileState));
    return value;
  };
  ctx.check = check;
  ctx.state = state;
  ctx.stopped = stopped;
  try {
    await runSmokePreflight(ctx);
    await runSmokeActivation(ctx);
  } catch {
    actions.report({ stage: ctx.stage, status: 'failed', redacted: true });
    throw new Error(`Private smoke failed at ${ctx.stage}`);
  } finally {
    let cleanupFailed = false;
    try {
      if (ctx.started && !ctx.retained) {
        const current = await actions.state();
        if (!stopped(current)) {
          requireValue(ctx.invocation && current.InvocationID === ctx.invocation);
          await actions.run('/usr/bin/systemctl', ['stop', unit]);
          requireValue(stopped(await actions.state()));
        }
      }
    } catch {
      cleanupFailed = true;
    }
    if (!cleanupFailed && !ctx.retained) {
      for (const record of ctx.owned.reverse()) {
        try {
          await actions.remove(record);
        } catch {
          cleanupFailed = true;
        }
      }
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
      process.removeListener(signal, terminate);
    if (cleanupFailed) {
      actions.report({
        stage: 'cleanup',
        status: 'failed',
        evidenceMayRemain: true,
        ownerReviewRequired: true,
      });
      // biome-ignore lint/correctness/noUnsafeFinally: evidence cleanup failure requires owner intervention.
      throw new Error(
        'Private smoke cleanup incomplete; owner review required'
      );
    }
  }
}
