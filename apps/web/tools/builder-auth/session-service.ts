import { resolveSession } from './refresh.ts';
import type { AuthStorage } from './storage.ts';
/** Trusted backend API only; never expose this return value to MCP or a browser. */
export function createLinkedSessionService(deps: {
  storage: AuthStorage;
  refresh: (token: string) => Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }>;
  verifyUser: (token: string) => Promise<string>;
}) {
  return async (identity: {
    connectionId: string;
    actorUserId: string;
    grantVersion: number;
  }) => {
    const tokens = await deps.storage.withSession(
      identity.connectionId,
      identity.grantVersion,
      (ctx) => {
        if (ctx.row.actorUserId !== identity.actorUserId)
          throw new Error('Reconnect Baci to continue.');
        return resolveSession(ctx.row, {
          ...ctx,
          refresh: deps.refresh,
          verifyUser: deps.verifyUser,
        });
      }
    );
    // Revocation could have committed while the upstream call was in flight.
    const current = await deps.storage.readConnection(identity.connectionId);
    if (
      !current ||
      current.actorUserId !== identity.actorUserId ||
      current.status !== 'active' ||
      current.grantVersion !== identity.grantVersion ||
      Date.parse(current.expiresAt) <= Date.now()
    )
      throw new Error('Reconnect Baci to continue.');
    return tokens.accessToken;
  };
}
