import { Client } from 'pg';
import type { ApproverConnectionConfig } from './build-connection-config';

export interface PgClientLike {
  connect: () => Promise<unknown>;
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: readonly unknown[] }>;
  end: () => Promise<unknown>;
}

/**
 * The real client, built from the whole config: pg reads an environment
 * variable only for a field that is missing, and none is.
 */
export function createPgClient(config: ApproverConnectionConfig): PgClientLike {
  return new Client(config);
}
