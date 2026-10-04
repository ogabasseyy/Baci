import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CONNECTOR_GRANT_METADATA_COLUMNS,
  connectorManagementErrorToHttp,
  connectorRequestFingerprint,
  newConnectorConnectionId,
  newConnectorTokenPair,
  toConnectorConnectionView,
} from '@/lib/connector/connection';
import { connectorError } from '@/lib/connector/errors';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  type ConnectorConnectionView,
  connectorConnectRequestSchema,
  connectorGrantRecordSchema,
} from '@/schemas/connector';
import {
  authenticateConnectorRequest,
  PRIVATE_NO_STORE,
  readActiveConnections,
  readConnectionById,
  readFailureResponse,
  reissueConnectionForRequest,
  resolveOwnerContext,
} from './connection-helpers';

/** Owner-authenticated, RLS-scoped grant management. Stable request IDs reissue
 * matching credentials without extending expiry. Business data is never modified.
 */

const merchantIdQuerySchema = z.strictObject({
  merchantId: z.uuid().optional(),
});

export async function GET(request: NextRequest) {
  const authentication = await authenticateConnectorRequest(request);
  if (!authentication.ok) return authentication.response;
  const query = merchantIdQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!query.success) {
    return NextResponse.json(
      { ...connectorError('INVALID_REQUEST', 'Invalid merchant scope.') },
      { status: 400, headers: PRIVATE_NO_STORE }
    );
  }

  const resolved = await resolveOwnerContext(
    request,
    query.data.merchantId,
    authentication
  );
  if (!resolved.ok) {
    return resolved.response;
  }

  const read = await readActiveConnections(
    resolved.context.supabase,
    resolved.context.merchantId
  );
  if (!read.ok) {
    return readFailureResponse();
  }
  return NextResponse.json(
    { connections: read.connections },
    { headers: PRIVATE_NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const authentication = await authenticateConnectorRequest(request);
  if (!authentication.ok) return authentication.response;
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { ...connectorError('INVALID_REQUEST', 'Invalid request body.') },
      { status: 400 }
    );
  }
  const parsed = connectorConnectRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ...connectorError('INVALID_REQUEST', 'Validation failed.') },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const resolved = await resolveOwnerContext(
    request,
    body.merchantId,
    authentication
  );
  if (!resolved.ok) {
    return resolved.response;
  }
  const { supabase, merchantId } = resolved.context;

  // Merchant scope: the body selector must equal the resolved owning
  // merchant; it is never trusted as authority on its own.
  if (body.merchantId !== merchantId) {
    return NextResponse.json(
      {
        ...connectorError(
          'FORBIDDEN_SCOPE',
          'Requested merchant is outside this connection.'
        ),
      },
      { status: 403 }
    );
  }

  // Empty allowlist plus no merchant-wide flag means zero access; refuse
  // to issue a useless grant rather than imply "all branches".
  if (!body.merchantWide && body.branchIds.length === 0) {
    return NextResponse.json(
      {
        ...connectorError(
          'INVALID_REQUEST',
          'Select at least one branch or entire-merchant access.'
        ),
      },
      { status: 400 }
    );
  }

  // Every call creates its own grant, so one merchant can connect
  // several agents independently. A stable connectionId makes retries
  // idempotent: a usable grant already carrying it is reissued instead
  // of creating a duplicate.
  const connectionId =
    body.connectionId ?? newConnectorConnectionId(merchantId);
  if (body.connectionId !== undefined) {
    // Direct lookup: the list read is capped, and a retry must never
    // miss its grant (and mint a duplicate) past the cap.
    const existing = await readConnectionById(
      supabase,
      merchantId,
      body.connectionId
    );
    if (!existing.ok) {
      return readFailureResponse();
    }
    const match =
      existing.connection?.usable === true ? existing.connection : null;
    if (match) {
      // Recovery: the first response may have been lost while the grant
      // exists. Reissue fresh credentials in place — the possibly-exposed
      // pair dies — instead of returning metadata without tokens.
      return reissueConnectionForRequest(
        supabase,
        match,
        existing.requestFingerprint,
        body
      );
    }
    if (existing.connection) {
      const state =
        existing.connection.status === 'revoked' ? 'disconnected' : 'expired';
      return NextResponse.json(
        {
          ...connectorError(
            'VERSION_CONFLICT',
            `This connection is ${state}; retry with a new connectionId.`
          ),
        },
        { status: 409, headers: PRIVATE_NO_STORE }
      );
    }
  }

  const tokens = newConnectorTokenPair();
  const expiresAt =
    body.expiresInSeconds === null
      ? null
      : new Date(Date.now() + body.expiresInSeconds * 1000).toISOString();

  const { data: grantId, error } = await supabase.rpc(
    'create_connector_grant_for_request',
    {
      p_branch_ids: body.branchIds,
      p_connection_id: connectionId,
      p_expires_at: expiresAt,
      p_merchant_id: merchantId,
      p_merchant_wide: body.merchantWide,
      p_refresh_token_hash: tokens.refreshTokenHash,
      p_scopes: body.scopes,
      p_token_hash: tokens.tokenHash,
      p_request_fingerprint: connectorRequestFingerprint(body, expiresAt),
    }
  );

  if (error || !grantId) {
    // A lost retry racing another create with the same stable id lands
    // on the connection_id unique constraint: re-read and reissue the
    // winner instead of failing the retry.
    if (error?.message?.includes('connector_grants_connection_id_key')) {
      const reread = await readConnectionById(
        supabase,
        merchantId,
        connectionId
      );
      if (!reread.ok) return readFailureResponse();
      const match =
        reread.ok && reread.connection?.usable === true
          ? reread.connection
          : undefined;
      if (match) {
        return reissueConnectionForRequest(
          supabase,
          match,
          reread.requestFingerprint,
          body
        );
      }
      // Connection ids are globally unique: no usable match in this
      // merchant means another merchant holds the id. 409, not 500.
      return NextResponse.json(
        {
          ...connectorError(
            'VERSION_CONFLICT',
            'Connection id already in use; retry with a new connectionId.'
          ),
        },
        { status: 409, headers: PRIVATE_NO_STORE }
      );
    }
    const mapped = connectorManagementErrorToHttp(error?.message ?? '');
    return NextResponse.json(
      { ...mapped.body },
      { status: mapped.status, headers: PRIVATE_NO_STORE }
    );
  }

  const { data: row, error: readError } = await supabase
    .from('connector_grants')
    .select(CONNECTOR_GRANT_METADATA_COLUMNS)
    .eq('id', grantId)
    .maybeSingle();
  const record = connectorGrantRecordSchema.safeParse(row);
  // The grant exists: a failed reread must not strand the one-time pair.
  // Every field below is known from this request (fresh rows are active
  // at version 1), so the fallback view is exact, not guessed.
  const grant: ConnectorConnectionView =
    !readError && record.success
      ? toConnectorConnectionView(record.data)
      : {
          grantId,
          connectionId,
          merchantId,
          branchIds: [...body.branchIds],
          merchantWide: body.merchantWide,
          scopes: [...body.scopes],
          status: 'active',
          version: 1,
          expiresAt: expiresAt,
          usable: expiresAt === null || Date.parse(expiresAt) > Date.now(),
        };

  // The raw pair is returned once for the owner to paste into Muse. It is
  // never logged and never readable again through this API.
  return NextResponse.json(
    {
      alreadyConnected: false,
      grant,
      refreshToken: tokens.refreshToken,
      token: tokens.token,
    },
    { status: 201, headers: PRIVATE_NO_STORE }
  );
}

export { disconnectConnector as DELETE } from './disconnect';
