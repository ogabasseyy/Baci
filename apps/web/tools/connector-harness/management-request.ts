import {
  bearerToken,
  issueTokenSchema,
  newOpaqueToken,
  readJsonBody,
  refreshSchema,
  revokeSchema,
  secretsEqual,
  sendJson,
  sha256Hex,
} from '../connector-http';
import {
  issueTestGrant,
  pgErrorToHttp,
  revokeTestGrant,
  rotateTestGrant,
} from './gateway';

import type { HarnessRequestContext } from './request-context';
export async function handleManagementRequest(
  context: HarnessRequestContext
): Promise<boolean> {
  const { request, response, config, sql, url, started, audit, sendError } =
    context;
  if (request.method === 'POST' && url.pathname === '/v0/issue-token') {
    const presented = bearerToken(request);
    if (!presented || !secretsEqual(presented, config.ownerSecret)) {
      sendError(response, 401, 'Not authorized.');
      return true;
    }
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendError(response, body.status, body.error);
      return true;
    }
    const parsed = issueTokenSchema.safeParse(body.value);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid issuance request.');
      return true;
    }
    const token = newOpaqueToken('mcn_test');
    const refreshToken = newOpaqueToken('mcn_test_refresh');
    const expiresAt =
      parsed.data.expires_in_seconds === null
        ? null
        : new Date(
            Date.now() + parsed.data.expires_in_seconds * 1000
          ).toISOString();
    try {
      const grantId = await issueTestGrant(sql, config.testOwnerUserId, {
        merchantId: config.testMerchantId,
        connectionId: parsed.data.connection_id,
        branchIds: parsed.data.branch_ids,
        scopes: [...parsed.data.scopes],
        merchantWide: parsed.data.merchant_wide,
        expiresAt,
        tokenHash: sha256Hex(token),
        refreshTokenHash: sha256Hex(refreshToken),
      });
      audit({
        route: '/v0/issue-token',
        grant_id: grantId,
        status: 201,
        ms: Date.now() - started,
      });
      sendJson(response, 201, {
        grant_id: grantId,
        token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      });
    } catch (error: unknown) {
      const mapped = pgErrorToHttp(error);
      audit({ route: '/v0/issue-token', status: mapped.status });
      sendJson(response, mapped.status, mapped.body);
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v0/refresh') {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendError(response, body.status, body.error);
      return true;
    }
    const parsed = refreshSchema.safeParse(body.value);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid refresh request.');
      return true;
    }
    const token = newOpaqueToken('mcn_test');
    const refreshToken = newOpaqueToken('mcn_test_refresh');
    let rotated: boolean;
    try {
      rotated = await rotateTestGrant(sql, {
        refreshTokenHash: sha256Hex(parsed.data.refresh_token),
        newTokenHash: sha256Hex(token),
        newRefreshTokenHash: sha256Hex(refreshToken),
      });
    } catch (error: unknown) {
      const mapped = pgErrorToHttp(error);
      audit({ route: '/v0/refresh', status: mapped.status });
      sendJson(response, mapped.status, mapped.body);
      return true;
    }
    if (!rotated) {
      audit({ route: '/v0/refresh', status: 401 });
      sendError(
        response,
        401,
        'Connector access is invalid, revoked, or expired.',
        'GRANT_REVOKED'
      );
      return true;
    }
    audit({ route: '/v0/refresh', status: 200, ms: Date.now() - started });
    sendJson(response, 200, { token, refresh_token: refreshToken });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v0/revoke') {
    const presented = bearerToken(request);
    if (!presented || !secretsEqual(presented, config.ownerSecret)) {
      sendError(response, 401, 'Not authorized.');
      return true;
    }
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendError(response, body.status, body.error);
      return true;
    }
    const parsed = revokeSchema.safeParse(body.value);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid revoke request.');
      return true;
    }
    let revoked: boolean;
    try {
      revoked = await revokeTestGrant(
        sql,
        config.testOwnerUserId,
        parsed.data.grant_id,
        'harness manual revoke'
      );
    } catch (error: unknown) {
      const mapped = pgErrorToHttp(error);
      audit({ route: '/v0/revoke', status: mapped.status });
      sendJson(response, mapped.status, mapped.body);
      return true;
    }
    audit({ route: '/v0/revoke', status: revoked ? 200 : 404 });
    if (!revoked) {
      sendError(response, 404, 'Grant not found or already revoked.');
      return true;
    }
    sendJson(response, 200, { revoked: true });
    return true;
  }

  return false;
}
