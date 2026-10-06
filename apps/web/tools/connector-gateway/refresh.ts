import {
  pgErrorToHttp,
  rotateTestGrant as rotateGatewayGrant,
} from '../connector-harness/gateway';
import {
  newOpaqueToken,
  readJsonBody,
  refreshSchema,
  sendJson,
  sha256Hex,
} from '../connector-http';

import type { GatewayRequestContext } from './request-context';

export async function handleRefresh(
  context: GatewayRequestContext
): Promise<void> {
  const { request, response, config, sql, url, started, audit, sendError } =
    context;
  if (!config.localGrantManagement) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 404,
      started,
    });
    sendError(response, 404, 'Not found.', 'INVALID_REQUEST');
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
  const parsed = refreshSchema.safeParse(body.value);
  if (!parsed.success) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 400,
      started,
    });
    sendError(response, 400, 'Invalid refresh request.', 'INVALID_REQUEST');
    return;
  }
  const token = newOpaqueToken('mcn');
  const refreshToken = newOpaqueToken('mcn_refresh');
  try {
    const rotated = await rotateGatewayGrant(sql, {
      refreshTokenHash: sha256Hex(parsed.data.refresh_token),
      newTokenHash: sha256Hex(token),
      newRefreshTokenHash: sha256Hex(refreshToken),
    });
    if (!rotated) {
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
    await audit({
      grantId: null,
      route: url.pathname,
      status: 200,
      started,
    });
    sendJson(response, 200, { token, refresh_token: refreshToken });
  } catch (error: unknown) {
    const mapped = pgErrorToHttp(error);
    await audit({
      grantId: null,
      route: url.pathname,
      status: mapped.status,
      started,
    });
    sendJson(response, mapped.status, mapped.body);
  }
}
