import type { UpstreamTokens } from './session-vault.ts';
export interface SessionState {
  actorUserId: string;
  connectionId: string;
  grantVersion: number;
  active: boolean;
  expiresAt: number;
  refreshStarted: boolean;
  tokens: UpstreamTokens;
}
export interface SessionRenewal {
  /** This must durably commit before sending the upstream refresh request. */
  markRefreshing: () => Promise<void>;
  save: (tokens: UpstreamTokens) => Promise<void>;
  /** Commit canonical revocation before acknowledging a failure. */
  revoke: () => Promise<void>;
  refresh: (refreshToken: string) => Promise<UpstreamTokens>;
  verifyUser: (accessToken: string) => Promise<string>;
}
/** Caller holds a distributed connection lock through this entire operation. */
export async function resolveSession(
  row: SessionState,
  deps: SessionRenewal
): Promise<UpstreamTokens> {
  if (!row.active || row.expiresAt <= Date.now())
    throw new Error('Reconnect Baci to continue.');
  try {
    if (row.refreshStarted) throw new Error('Indeterminate prior refresh');
    let tokens = row.tokens;
    if (tokens.expiresAt <= Date.now() + 30000) {
      await deps.markRefreshing();
      tokens = await deps.refresh(tokens.refreshToken);
      if (tokens.expiresAt <= Date.now() + 30000)
        throw new Error('Expired upstream response');
      if ((await deps.verifyUser(tokens.accessToken)) !== row.actorUserId)
        throw new Error('Subject mismatch');
      await deps.save(tokens);
    } else if ((await deps.verifyUser(tokens.accessToken)) !== row.actorUserId)
      throw new Error('Subject mismatch');
    return tokens;
  } catch {
    await deps.revoke();
    throw new Error('Reconnect Baci to continue.');
  }
}
