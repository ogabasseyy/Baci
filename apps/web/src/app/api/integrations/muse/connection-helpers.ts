import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  CONNECTOR_GRANT_METADATA_COLUMNS,
  canManageConnectorConnection,
  connectionMatchesRequest,
  connectorManagementErrorToHttp,
  type IssuedConnectorTokens,
  newConnectorTokenPair,
  toConnectorConnectionView,
} from '@/lib/connector/connection';
import { connectorError } from '@/lib/connector/errors';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import {
  type ConnectorConnectionView,
  type ConnectorConnectRequest,
  connectorGrantRecordSchema,
} from '@/schemas/connector';

export const PRIVATE_NO_STORE = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
} as const;
interface OwnerContext {
  supabase: SupabaseClient;
  merchantId: string;
}

export async function resolveOwnerContext(
  request: NextRequest,
  requestedMerchantId?: string | null
): Promise<
  { ok: true; context: OwnerContext } | { ok: false; response: NextResponse }
> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: PRIVATE_NO_STORE }
      ),
    };
  }

  const merchantContext = await getMerchantForApiRequest(
    auth.supabase,
    auth.user.id,
    { requestedMerchantId: requestedMerchantId ?? null }
  );
  if (!merchantContext) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404, headers: PRIVATE_NO_STORE }
      ),
    };
  }

  if (!canManageConnectorConnection(merchantContext.staffAccess)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ...connectorError(
            'FORBIDDEN_SCOPE',
            'Only the merchant owner can manage the Muse connector.'
          ),
        },
        { status: 403, headers: PRIVATE_NO_STORE }
      ),
    };
  }

  return {
    ok: true,
    context: {
      supabase: auth.supabase,
      merchantId: merchantContext.merchantId,
    },
  };
}

type ActiveConnectionsRead =
  | { ok: true; connections: ConnectorConnectionView[] }
  | { ok: false };

const MAX_CONNECTIONS_LISTED = 50;

export async function readActiveConnections(
  supabase: SupabaseClient,
  merchantId: string
): Promise<ActiveConnectionsRead> {
  const { data, error } = await supabase
    .from('connector_grants')
    .select(CONNECTOR_GRANT_METADATA_COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(MAX_CONNECTIONS_LISTED);

  // Query and record-validation failures are call errors, never an
  // empty result: callers must fail closed instead of reporting
  // "disconnected" or issuing over an outage.
  if (error || !Array.isArray(data)) {
    return { ok: false };
  }
  const connections: ConnectorConnectionView[] = [];
  for (const row of data) {
    const parsed = connectorGrantRecordSchema.safeParse(row);
    if (!parsed.success) {
      return { ok: false };
    }
    connections.push(toConnectorConnectionView(parsed.data));
  }
  return { ok: true, connections };
}

type ConnectionByIdRead =
  | {
      ok: true;
      connection: ConnectorConnectionView | null;
      requestFingerprint: string | null;
    }
  | { ok: false };

export async function readConnectionById(
  supabase: SupabaseClient,
  merchantId: string,
  connectionId: string
): Promise<ConnectionByIdRead> {
  const { data: row, error } = await supabase
    .from('connector_grants')
    .select(CONNECTOR_GRANT_METADATA_COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (error) {
    return { ok: false };
  }
  if (row === null) {
    return { ok: true, connection: null, requestFingerprint: null };
  }
  const parsed = connectorGrantRecordSchema.safeParse(row);
  if (!parsed.success) {
    return { ok: false };
  }
  return {
    ok: true,
    connection: toConnectorConnectionView(parsed.data),
    requestFingerprint: parsed.data.request_fingerprint ?? null,
  };
}

export async function reissueConnectionForRequest(
  supabase: SupabaseClient,
  connection: ConnectorConnectionView,
  fingerprint: string | null,
  request: ConnectorConnectRequest
): Promise<NextResponse> {
  if (!connectionMatchesRequest(connection, fingerprint, request)) {
    return NextResponse.json(
      connectorError(
        'IDEMPOTENCY_KEY_REUSED',
        'Connection id belongs to a different request; use a new connectionId.'
      ),
      { status: 409, headers: PRIVATE_NO_STORE }
    );
  }
  const reissued = await reissueConnectionTokens(supabase, connection.grantId);
  if (!reissued.ok) return reissued.response;
  return NextResponse.json(
    {
      alreadyConnected: true,
      reissued: true,
      grant: connection,
      refreshToken: reissued.tokens.refreshToken,
      token: reissued.tokens.token,
    },
    { headers: PRIVATE_NO_STORE }
  );
}

export function readFailureResponse(): NextResponse {
  const mapped = connectorManagementErrorToHttp('__unreadable__');
  return NextResponse.json(
    { ...mapped.body },
    { status: mapped.status, headers: PRIVATE_NO_STORE }
  );
}

type ReissueResult =
  | { ok: true; tokens: IssuedConnectorTokens }
  | { ok: false; response: NextResponse };

export async function reissueConnectionTokens(
  supabase: SupabaseClient,
  grantId: string
): Promise<ReissueResult> {
  const tokens = newConnectorTokenPair();
  const { data, error } = await supabase.rpc('reissue_connector_grant_tokens', {
    p_grant_id: grantId,
    p_new_token_hash: tokens.tokenHash,
    p_new_refresh_token_hash: tokens.refreshTokenHash,
  });
  if (error) {
    const mapped = connectorManagementErrorToHttp(error.message);
    return {
      ok: false,
      response: NextResponse.json(
        { ...mapped.body },
        { status: mapped.status, headers: PRIVATE_NO_STORE }
      ),
    };
  }
  if (data !== true) {
    // The match changed between read and reissue (revoked, expired, or
    // ownership moved): recover by re-listing, not by guessing.
    return {
      ok: false,
      response: NextResponse.json(
        {
          ...connectorError(
            'VERSION_CONFLICT',
            'Connection changed; refresh the list and retry, or disconnect and reconnect.'
          ),
        },
        { status: 409, headers: PRIVATE_NO_STORE }
      ),
    };
  }
  return { ok: true, tokens };
}
