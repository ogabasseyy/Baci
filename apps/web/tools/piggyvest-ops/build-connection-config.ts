import type { OpsApproveArgs } from '@/schemas/piggyvest/ops-approve-args';
import { isLoopbackHost } from './is-loopback-host';

export interface ApproverConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: true; ca?: string };
  application_name: string;
  options: string;
  client_encoding: string;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
}

/**
 * Every field is explicit, so pg never falls back to environment variables
 * or a password file. The password is only ever the one typed at the prompt.
 * Remote connections always verify the server certificate.
 */
export function buildConnectionConfig(
  args: OpsApproveArgs,
  password: string,
  certificateAuthority?: string
): ApproverConnectionConfig {
  return {
    host: args.host,
    port: args.port,
    database: args.database,
    user: args.user,
    password,
    ssl: isLoopbackHost(args.host)
      ? false
      : {
          rejectUnauthorized: true,
          ...(certificateAuthority ? { ca: certificateAuthority } : {}),
        },
    application_name: 'baci-piggyvest-approve',
    options: '-c search_path=pg_catalog',
    client_encoding: 'UTF8',
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 10_000,
  };
}
