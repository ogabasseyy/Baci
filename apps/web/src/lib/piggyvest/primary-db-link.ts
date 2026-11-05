import 'server-only';
import { PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN as PROJECT_REF } from '@/schemas/piggyvest-env';

/**
 * One rule for how PiggyVest restricted-login executors reach Postgres.
 *
 * Direct mode (default): bare login, session settings sent as startup
 * parameters. Pooler mode (PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF set): the
 * Supabase Supavisor session-mode pooler (port 5432, IPv4) needs the user
 * `<login>.<project_ref>`. Supavisor does not document forwarding startup
 * `options`, so the same settings are applied with SET on the session right
 * after connect. The database session user stays the bare role, so session
 * verification keeps comparing against the bare login. Port 6543 (transaction
 * mode) is rejected: it does not keep session SET values.
 */
const TRANSACTION_POOLER_PORT = 6543;
const SESSION_SETTINGS =
  'SET search_path TO pg_catalog; SET statement_timeout = 2500; SET lock_timeout = 1500';

export type PrimaryDbLink = {
  /** Value for the pg `user` option. */
  user: string;
  /** Spread into the pg client config (empty in pooler mode). */
  startup: {
    options?: string;
    statement_timeout?: number;
    lock_timeout?: number;
  };
  /** Call right after `client.connect()`, before any other query. */
  afterConnect: (client: {
    query: (text: string) => Promise<unknown>;
  }) => Promise<void>;
};

export function primaryDbLink(login: string, port: number): PrimaryDbLink {
  const ref = process.env.PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF;
  if (ref === undefined || ref === '') {
    return {
      user: login,
      startup: {
        options: '-c search_path=pg_catalog',
        statement_timeout: 2500,
        lock_timeout: 1500,
      },
      afterConnect: async () => undefined,
    };
  }
  if (!PROJECT_REF.test(ref) || port === TRANSACTION_POOLER_PORT)
    throw new Error('PiggyVest database pooler configuration invalid');
  return {
    user: `${login}.${ref}`,
    startup: {},
    afterConnect: async (client) => {
      await client.query(SESSION_SETTINGS);
    },
  };
}
