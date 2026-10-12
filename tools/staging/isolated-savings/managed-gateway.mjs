import { isDeepStrictEqual } from 'node:util';
import { renderPrivateRoutingConfig } from './private-routing.mjs';
import {
  validatePrivateRouting,
  validateRoutingIdentity,
  validateRoutingIdentityShape,
} from './private-routing-inventory.mjs';

export const MAX_MANAGED_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

export function validateManagedBinding(binding, now) {
  if (
    !binding ||
    typeof binding !== 'object' ||
    Array.isArray(binding) ||
    Object.keys(binding).sort().join(',') !==
      'identity,leaseExpiresAt,leaseNotBefore,reviewedAt,version' ||
    binding.version !== 1 ||
    !Number.isSafeInteger(now)
  )
    throw new Error('Managed binding rejected');
  const reviewed = Date.parse(binding.reviewedAt);
  const start = Date.parse(binding.leaseNotBefore);
  const end = Date.parse(binding.leaseExpiresAt);
  if (
    ![reviewed, start, end].every(Number.isFinite) ||
    reviewed > start ||
    start > now ||
    end <= now ||
    end - start > MAX_MANAGED_LEASE_MS ||
    reviewed <= 0
  )
    throw new Error('Managed lease rejected');
  for (const name of ['reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'])
    if (new Date(binding[name]).toISOString() !== binding[name])
      throw new Error('Managed lease timestamp rejected');
  validateRoutingIdentityShape(binding.identity);
  return { reviewed, start, end };
}

export function validateManagedStartup(binding, input, now) {
  const approved = validateManagedBinding(binding, now);
  validatePrivateRouting(input.receipt, input.inventory, now);
  if (now >= Date.parse(input.receipt.verifiedAt) + 300000)
    throw new Error('Startup evidence expired');
  const { host, containers, networks, restRoutes } = input.receipt;
  if (
    !isDeepStrictEqual(binding.identity, {
      host,
      containers,
      networks,
      restRoutes,
    })
  )
    throw new Error('Startup identity mismatch');
  return approved;
}

export function generateManagedGateway(binding, inventory, now) {
  const { end, reviewed } = validateManagedBinding(binding, now);
  const observed = Date.parse(inventory?.observedAt);
  if (
    !Number.isFinite(observed) ||
    observed > now ||
    observed < reviewed ||
    now - observed > 5000
  )
    throw new Error('Managed inventory stale');
  const checked = validateRoutingIdentity(binding.identity, inventory);
  return {
    config: renderPrivateRoutingConfig(checked, true),
    expiresAt: new Date(end).toISOString(),
  };
}

export async function startManagedGateway(binding, input, actions, signal) {
  let child;
  const frozen = structuredClone(binding);
  const startedAt = actions.now();
  const monotonicStart = actions.monotonicNow();
  let lastNow = startedAt;
  let lastMonotonic = monotonicStart;
  try {
    if (!Number.isFinite(monotonicStart))
      throw new Error('Managed clock rejected');
    const { end } = validateManagedStartup(frozen, input, startedAt);
    const duration = end - startedAt;
    const check = async () => {
      if (signal.aborted) throw new Error('Managed gateway stopped');
      const currentBinding = await actions.binding();
      const inventory = await actions.inventory();
      const now = actions.now();
      const monotonic = actions.monotonicNow();
      if (
        !isDeepStrictEqual(currentBinding, frozen) ||
        now < lastNow ||
        !Number.isFinite(monotonic) ||
        monotonic < lastMonotonic ||
        monotonic - monotonicStart >= duration
      )
        throw new Error('Managed binding withdrawn');
      lastNow = now;
      lastMonotonic = monotonic;
      return generateManagedGateway(frozen, inventory, now).config;
    };
    const config = await check();
    await actions.prepare(config, signal);
    if ((await check()) !== config || signal.aborted)
      throw new Error('Managed routing changed');
    child = await actions.start(signal);
    while (!signal.aborted) {
      if (!child.alive() || (await check()) !== config)
        throw new Error('Managed routing withdrawn');
      await Promise.race([
        actions.pause(signal),
        child.exited.then(() => {
          throw new Error('Managed child exited');
        }),
      ]);
    }
  } finally {
    try {
      if (child) await actions.stop(child);
    } finally {
      await actions.cleanup();
    }
  }
}
