/**
 * Durable gateway audit records (R1).
 *
 * One row per call in `public.connector_gateway_audit`: grant id (when a
 * grant was resolved), route, status, latency. The allowlist builder below
 * is the only writer shape: it picks exactly these fields and drops
 * everything else, so credentials and request/response payloads can never
 * reach the audit table even if a caller passes them in.
 */

import type postgres from 'postgres';

export interface GatewayAuditEntry {
  grantId: string | null;
  route: string;
  status: number;
  latencyMs: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Allowlist unknown input into the exact audit shape; rejects the rest. */
export function toAuditEntry(candidate: unknown): GatewayAuditEntry {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('invalid_gateway_audit_entry');
  }
  const record = candidate as Record<string, unknown>;
  const { grantId, route, status, latencyMs } = record;
  if (
    grantId !== null &&
    (typeof grantId !== 'string' || !UUID_PATTERN.test(grantId))
  ) {
    throw new Error('invalid_gateway_audit_entry');
  }
  if (typeof route !== 'string' || route.length === 0 || route.length > 200) {
    throw new Error('invalid_gateway_audit_entry');
  }
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  ) {
    throw new Error('invalid_gateway_audit_entry');
  }
  if (
    typeof latencyMs !== 'number' ||
    !Number.isInteger(latencyMs) ||
    latencyMs < 0
  ) {
    throw new Error('invalid_gateway_audit_entry');
  }
  return { grantId, route, status, latencyMs };
}

export async function recordGatewayAudit(
  sql: postgres.Sql,
  entry: GatewayAuditEntry
): Promise<void> {
  await sql`
    INSERT INTO public.connector_gateway_audit
      (grant_id, route, status, latency_ms)
    VALUES (
      ${entry.grantId}::uuid, ${entry.route}, ${entry.status}, ${entry.latencyMs}
    )
  `;
}

export function createGatewayAudit(sql: postgres.Sql) {
  async function audit(input: {
    grantId: string | null;
    route: string;
    status: number;
    started: number;
  }): Promise<void> {
    try {
      await recordGatewayAudit(
        sql,
        toAuditEntry({
          grantId: input.grantId,
          route: input.route,
          status: input.status,
          latencyMs: Math.max(Date.now() - input.started, 0),
        })
      );
    } catch {
      process.stderr.write(
        `${JSON.stringify({ event: 'gateway_audit_failed', route: input.route, status: input.status })}\n`
      );
    }
  }

  return audit;
}
