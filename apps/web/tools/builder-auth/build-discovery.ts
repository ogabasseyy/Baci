import { z } from 'zod';
import { builderAuthDiscoverySchemas } from '../../src/schemas/experience-builder-auth.ts';

export const LINKED_BUILD_READ_TIMEOUT_MS = 10_000;
const { uuid, connection, ids: buildIds } = builderAuthDiscoverySchemas(z);
type Binding = {
  connectionId: string;
  actorUserId: string;
  grantVersion: number;
};
type Client = {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

/** Explicit single-job tick. Does not start a loop or grant access to job data. */
export function createLinkedBuildDiscovery(deps: {
  listConnections(after: string | null, limit: number): Promise<string[]>;
  readConnection(id: string): Promise<unknown>;
  resolveLinkedAccessToken(binding: Binding): Promise<string>;
  resolveUser(
    token: string,
    signal: AbortSignal
  ): Promise<{ actorUserId: string; client: Client }>;
  execute(
    input: Binding & { merchantId: string; jobId: string }
  ): Promise<void>;
}) {
  return {
    async runOnce(after: string | null = null, admission?: AbortSignal) {
      admission?.throwIfAborted();
      if (after !== null) uuid.parse(after);
      const ids = buildIds.parse(await deps.listConnections(after, 20));
      let cursor: string | null = null;
      let executed = 0;
      let failed = 0;
      let connections = 0;
      for (const id of ids) {
        admission?.throwIfAborted();
        cursor = id;
        connections++;
        try {
          const parsed = connection.safeParse(await deps.readConnection(id));
          admission?.throwIfAborted();
          if (
            !parsed.success ||
            parsed.data.connectionId !== id ||
            !Number.isFinite(Date.parse(parsed.data.expiresAt)) ||
            Date.parse(parsed.data.expiresAt) <= Date.now() ||
            !parsed.data.scopes.includes('storefront.write')
          )
            continue;
          const row = parsed.data;
          const binding = {
            connectionId: id,
            actorUserId: row.actorUserId,
            grantVersion: row.grantVersion,
          };
          const accessToken = await deps.resolveLinkedAccessToken(binding);
          admission?.throwIfAborted();
          const deadline = AbortSignal.timeout(LINKED_BUILD_READ_TIMEOUT_MS);
          const signal = admission
            ? AbortSignal.any([admission, deadline])
            : deadline;
          const user = await deps.resolveUser(accessToken, signal);
          signal.throwIfAborted();
          if (user.actorUserId !== row.actorUserId) throw Error('Reconnect');
          for (const merchantId of row.allowedMerchantIds) {
            const result = await user.client.rpc('experience_list_due_builds', {
              p_merchant: merchantId,
              p_connection: id,
              p_version: row.grantVersion,
            });
            signal.throwIfAborted();
            if (result.error) throw Error('Discovery unavailable');
            const jobs = buildIds.parse(result.data);
            if (jobs.length) {
              await deps.execute({
                ...binding,
                merchantId,
                jobId: jobs[0],
              });
              executed++;
              break;
            }
          }
        } catch {
          admission?.throwIfAborted();
          failed++;
        }
        if (executed) break;
      }
      return { cursor, connections, executed, failed };
    },
  };
}
