import { z } from 'zod';

const uuid = z.uuid();
const connectionSchema = z.object({
  connectionId: uuid,
  actorUserId: uuid,
  grantVersion: z.number().int().positive().safe(),
  status: z.literal('active'),
  expiresAt: z.string(),
  revokedAt: z.null(),
  scopes: z.array(z.string()),
  allowedMerchantIds: z.array(uuid).max(1),
});
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
  resolveUser(token: string): Promise<{ actorUserId: string; client: Client }>;
  execute(
    input: Binding & { merchantId: string; jobId: string }
  ): Promise<void>;
}) {
  return {
    async runOnce(after: string | null = null) {
      if (after !== null) uuid.parse(after);
      const ids = z
        .array(uuid)
        .max(20)
        .parse(await deps.listConnections(after, 20));
      let cursor: string | null = null;
      let executed = 0;
      let failed = 0;
      let connections = 0;
      for (const id of ids) {
        cursor = id;
        connections++;
        try {
          const parsed = connectionSchema.safeParse(
            await deps.readConnection(id)
          );
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
          const user = await deps.resolveUser(accessToken);
          if (user.actorUserId !== row.actorUserId) throw Error('Reconnect');
          for (const merchantId of row.allowedMerchantIds) {
            const result = await user.client.rpc('experience_list_due_builds', {
              p_merchant: merchantId,
              p_connection: id,
              p_version: row.grantVersion,
            });
            if (result.error) throw Error('Discovery unavailable');
            const jobs = z.array(uuid).max(20).parse(result.data);
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
          failed++;
        }
        if (executed) break;
      }
      return { cursor, connections, executed, failed };
    },
  };
}
