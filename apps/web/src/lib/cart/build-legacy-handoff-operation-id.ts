import { createHash, randomUUID } from 'node:crypto';
import { MCP_IMPORT_HANDOFF_OPERATION_PREFIX } from '@/schemas/cart-legacy-bridge';

export function buildLegacyHandoffOperationId(
  cartId: string,
  operationId: string | undefined,
  importMcp: boolean
): string {
  const prefix = importMcp
    ? MCP_IMPORT_HANDOFF_OPERATION_PREFIX
    : 'legacy-handoff:';
  const key =
    operationId ??
    (importMcp
      ? randomUUID()
      : `read-window:${Math.floor(Date.now() / 240000)}`);
  return prefix + createHash('sha256').update(`${cartId}|${key}`).digest('hex');
}
