import { expect, type vi } from 'vitest';
import {
  callStorefrontPreflightRpc,
  type StorefrontPreflightRpcContext,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';

/** Builds a fail-open context for the RPC transport tests, with sane defaults. */
export function context(
  overrides: Partial<StorefrontPreflightRpcContext> = {}
): StorefrontPreflightRpcContext {
  return {
    surface: 'product-slug',
    identifier: 'ogabassey.com',
    slug: 'default-slug',
    ...overrides,
  };
}

/** Invokes the transport under test with a context built from `contextOverrides`. */
export function callRpc(
  fn: string,
  args: Record<string, string>,
  rpcImpl: StorefrontPreflightRpcImpl,
  contextOverrides: Partial<StorefrontPreflightRpcContext> = {},
  transportOptions: { emptyResult?: 'unknown' } = {}
) {
  return callStorefrontPreflightRpc(fn, args, {
    failOpenContext: context(contextOverrides),
    rpcImpl,
    ...transportOptions,
  });
}

export function expectFailOpenReason(
  consoleWarnSpy: ReturnType<typeof vi.spyOn>,
  reason: string
) {
  expect(consoleWarnSpy).toHaveBeenCalledWith(
    '[storefront-internal-preflight] fail-open',
    expect.objectContaining({ reason })
  );
}

export function expectSkipReason(
  consoleWarnSpy: ReturnType<typeof vi.spyOn>,
  reason: string
) {
  expect(consoleWarnSpy).toHaveBeenCalledWith(
    '[storefront-internal-preflight] skip',
    expect.objectContaining({ reason })
  );
}
