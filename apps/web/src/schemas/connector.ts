import { z } from 'zod';
import {
  CONNECTOR_GRANT_STATUSES,
  CONNECTOR_SCOPES,
} from '@/lib/connector/grant';
import {
  CONNECTOR_TOOL_NAMES,
  CONNECTOR_TOOL_SCOPES,
} from '@/lib/connector/manifest';

export const connectorToolNameSchema = z.enum(CONNECTOR_TOOL_NAMES);

export const connectorScopeSchema = z.enum(CONNECTOR_SCOPES);
export const connectorToolScopeSchema = z.enum(CONNECTOR_TOOL_SCOPES);

export const connectorGrantRecordSchema = z.strictObject({
  id: z.uuid(),
  connection_id: z.string().min(1),
  user_id: z.uuid(),
  merchant_id: z.uuid(),
  branch_ids: z.array(z.uuid()),
  merchant_wide: z.boolean(),
  scopes: z.array(connectorScopeSchema),
  status: z.enum(CONNECTOR_GRANT_STATUSES),
  version: z.int().min(1),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
  revoke_reason: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  request_fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
});

export type ConnectorGrantRecord = z.infer<typeof connectorGrantRecordSchema>;

/**
 * Merchant-visible grant metadata for the owners-only Connect/Disconnect
 * interface. Token hashes are never part of this shape: the column grant
 * excludes them and this schema cannot express them.
 */
export const connectorConnectionViewSchema = z.strictObject({
  grantId: z.uuid(),
  connectionId: z.string().min(1),
  merchantId: z.uuid(),
  branchIds: z.array(z.uuid()),
  merchantWide: z.boolean(),
  scopes: z.array(connectorScopeSchema),
  status: z.enum(CONNECTOR_GRANT_STATUSES),
  version: z.int().min(1),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  /** Live usability: active status plus unexpired. */
  usable: z.boolean(),
});

export type ConnectorConnectionView = z.infer<
  typeof connectorConnectionViewSchema
>;

export const connectorConnectRequestSchema = z.strictObject({
  merchantId: z.uuid(),
  branchIds: z.array(z.uuid()).max(200).default([]),
  scopes: z.array(connectorToolScopeSchema).min(1).max(4),
  merchantWide: z.boolean().default(false),
  /** Seconds from issuance; null means no expiry. Max 90 days. */
  expiresInSeconds: z
    .int()
    .min(60)
    .max(90 * 86400)
    .nullable()
    .default(2592000),
  /**
   * Optional stable id for retry-safe connect: when supplied and a usable
   * grant already carries it, fresh credentials are reissued for that
   * connection instead of creating a duplicate. Omitted calls always
   * create a fresh grant, so one merchant can connect several agents
   * independently. Ids are globally unique: a collision with another
   * merchant's id returns 409 VERSION_CONFLICT.
   */
  connectionId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export type ConnectorConnectRequest = z.infer<
  typeof connectorConnectRequestSchema
>;

export const connectorDisconnectRequestSchema = z.strictObject({
  merchantId: z.uuid(),
  grantId: z.uuid(),
});

export type ConnectorDisconnectRequest = z.infer<
  typeof connectorDisconnectRequestSchema
>;
