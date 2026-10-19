import {
  issueTestGrant as issueGatewayGrant,
  pgErrorToHttp,
} from '../connector-harness/gateway';
import {
  issueTokenSchema,
  newOpaqueToken,
  readJsonBody,
  secretsEqual,
  sendJson,
  sha256Hex,
} from '../connector-http';

import type { GatewayRequestContext } from './request-context';

export async function handleIssueToken(
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
  const parsed = issueTokenSchema.safeParse(body.value);
  if (!parsed.success) {
    await audit({
      grantId: null,
      route: url.pathname,
      status: 400,
      started,
    });
    sendError(response, 400, 'Invalid issuance request.', 'INVALID_REQUEST');
    return;
  }
  const token = newOpaqueToken('mcn');
  const refreshToken = newOpaqueToken('mcn_refresh');
  const expiresAt =
    parsed.data.expires_in_seconds === null
      ? null
      : new Date(
          Date.now() + parsed.data.expires_in_seconds * 1000
        ).toISOString();
  try {
    const grantId = await issueGatewayGrant(
      sql,
      localGrantManagement.ownerUserId,
      {
        merchantId: localGrantManagement.merchantId,
        connectionId: parsed.data.connection_id,
        branchIds: parsed.data.branch_ids,
        scopes: [...parsed.data.scopes],
        merchantWide: parsed.data.merchant_wide,
        expiresAt,
        tokenHash: sha256Hex(token),
        refreshTokenHash: sha256Hex(refreshToken),
      }
    );
    await audit({ grantId, route: url.pathname, status: 201, started });
    sendJson(response, 201, {
      grant_id: grantId,
      token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    });
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
