import {
  pgErrorToHttp,
  revokeTestGrant as revokeGatewayGrant,
} from '../connector-harness/gateway';
import {
  readJsonBody,
  revokeSchema,
  secretsEqual,
  sendJson,
} from '../connector-http';

import type { GatewayRequestContext } from './request-context';

export async function handleRevoke(
  context: GatewayRequestContext
): Promise<void> {
  const {
    request,
    response,
    config,
    sql,
    presented,
    url,
    started,
    audit,
    sendError,
  } = context;
  const localGrantManagement = config.localGrantManagement;
  if (!localGrantManagement) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 404,
      started,
    });
    sendError(response, 404, 'Not found.', 'INVALID_REQUEST');
    return;
  }
  if (
    !presented ||
    !secretsEqual(presented, localGrantManagement.ownerSecret)
  ) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 401,
      started,
    });
    sendError(response, 401, 'Not authorized.', 'INVALID_REQUEST');
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
  const parsed = revokeSchema.safeParse(body.value);
  if (!parsed.success) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 400,
      started,
    });
    sendError(response, 400, 'Invalid revoke request.', 'INVALID_REQUEST');
    return;
  }
  try {
    const revoked = await revokeGatewayGrant(
      sql,
      localGrantManagement.ownerUserId,
      parsed.data.grant_id,
      'gateway owner revoke'
    );
    await audit({
      grantId: parsed.data.grant_id,
      route: url.pathname,
      status: revoked ? 200 : 404,
      started,
    });
    if (!revoked) {
      sendError(
        response,
        404,
        'Grant not found or already revoked.',
        'GRANT_REVOKED'
      );
      return;
    }
    sendJson(response, 200, { revoked: true });
  } catch (error: unknown) {
    const mapped = pgErrorToHttp(error);
    await audit({
      grantId: parsed.data.grant_id,
      route: url.pathname,
      status: mapped.status,
      started,
    });
    sendJson(response, mapped.status, mapped.body);
  }
}
