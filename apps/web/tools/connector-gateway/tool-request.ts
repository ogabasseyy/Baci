import {
  getConnectorTool,
  isConnectorToolName,
} from '../../src/lib/connector/manifest';
import {
  establishUserContext,
  pgErrorToHttp,
  readAnalyticsSummary,
  readInventoryLevels,
  readOrderGet,
  readOrdersList,
  resolveGrant,
} from '../connector-harness/gateway';
import {
  readJsonBody,
  sendJson,
  sha256Hex,
  TOOL_RESOURCES,
} from '../connector-http';

import type { GatewayRequestContext } from './request-context';

export async function handleToolRequest(
  context: GatewayRequestContext,
  encodedToolName: string
): Promise<void> {
  const {
    request,
    response,
    sql,
    presented,
    url,
    started,
    audit,
    sendError,
    validators,
  } = context;
  const toolName = decodeURIComponent(encodedToolName);
  if (!isConnectorToolName(toolName)) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 404,
      started,
    });
    sendError(response, 404, 'Unknown connector tool.', 'INVALID_REQUEST');
    return;
  }
  if (!presented) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 401,
      started,
    });
    sendError(
      response,
      401,
      'Connector access is invalid, revoked, or expired.',
      'GRANT_REVOKED'
    );
    return;
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: body.status,
      started,
    });
    sendError(response, body.status, body.error, 'INVALID_REQUEST');
    return;
  }
  const validate = validators.get(toolName);
  if (!validate?.(body.value)) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 400,
      started,
    });
    sendError(response, 400, 'Invalid request body.', 'INVALID_REQUEST');
    return;
  }
  const tool = getConnectorTool(toolName);
  const mapping = TOOL_RESOURCES[toolName];
  if (!tool || !mapping) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 404,
      started,
    });
    sendError(response, 404, 'Unknown connector tool.', 'INVALID_REQUEST');
    return;
  }
  const args = body.value as Record<string, unknown>;
  // Empty selector parity: [] behaves like an omitted selector.
  const requestedBranchIds =
    Array.isArray(args.branch_ids) && args.branch_ids.length > 0
      ? (args.branch_ids as string[])
      : null;
  let grantId: string | null = null;
  try {
    const result = await sql.begin(async (txn) => {
      const context = await resolveGrant(txn, {
        tokenHash: sha256Hex(presented),
        scope: tool.requiredScope,
        resource: mapping.resource,
        action: mapping.action,
        branchIds: requestedBranchIds,
      });
      grantId = context.grantId;
      // Selectors are never authority: a merchant selector outside
      // the resolved grant is rejected before any data query.
      if (
        typeof args.merchant_id === 'string' &&
        args.merchant_id !== context.merchantId
      ) {
        throw new Error('connector_scope_denied');
      }
      await establishUserContext(txn, context.userId);
      if (toolName === 'orders.list') {
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        return {
          orders: await readOrdersList(txn, context, requestedBranchIds, limit),
        };
      }
      if (toolName === 'inventory.levels') {
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        return {
          levels: await readInventoryLevels(
            txn,
            context,
            requestedBranchIds,
            limit
          ),
        };
      }
      if (toolName === 'analytics.summary') {
        return {
          summary: await readAnalyticsSummary(txn, context, requestedBranchIds),
        };
      }
      const order = await readOrderGet(txn, context, args.order_id as string);
      return { order };
    });
    if (
      toolName === 'orders.get' &&
      (result as { order: unknown }).order === null
    ) {
      await audit({ grantId, route: url.pathname, status: 404, started });
      sendError(response, 404, 'Order not found.', 'INVALID_REQUEST');
      return;
    }
    await audit({ grantId, route: url.pathname, status: 200, started });
    sendJson(response, 200, {
      ...result,
      as_of: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const mapped = pgErrorToHttp(error);
    await audit({
      grantId,
      route: url.pathname,
      status: mapped.status,
      started,
    });
    sendJson(response, mapped.status, mapped.body);
  }
}
