import { SingleFlight } from './single-flight';

type RpcImpl = (...args: never[]) => unknown;

let nextRpcImplId = 1;
const rpcImplIds = new WeakMap<RpcImpl, number>();

function rpcImplId(rpcImpl: RpcImpl): number {
  const known = rpcImplIds.get(rpcImpl);
  if (known !== undefined) return known;

  const id = nextRpcImplId;
  nextRpcImplId += 1;
  rpcImplIds.set(rpcImpl, id);
  return id;
}

/** Captures the immutable string payload shared by a deferred transport read. */
export function snapshotStorefrontPreflightRpcArgs(
  args: Record<string, string>
): Record<string, string> {
  return { ...args };
}

/** Includes every option that changes a transport attempt's behavior. */
export function storefrontPreflightRpcFlightKey(
  memoKey: string,
  timeoutMs: number,
  vercelEnv: string | undefined,
  rpcImpl: RpcImpl
): string {
  return JSON.stringify([
    memoKey,
    String(timeoutMs),
    vercelEnv,
    rpcImplId(rpcImpl),
  ]);
}

class StorefrontPreflightRpcFlights {
  private reads = new SingleFlight<unknown | null>();

  run(
    key: string,
    load: () => Promise<unknown | null>
  ): Promise<unknown | null> {
    return this.reads.run(key, load);
  }

  reset(): void {
    this.reads = new SingleFlight<unknown | null>();
  }
}

export const storefrontPreflightRpcFlights =
  new StorefrontPreflightRpcFlights();
