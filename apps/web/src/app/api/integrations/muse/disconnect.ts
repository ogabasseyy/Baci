import { type NextRequest, NextResponse } from 'next/server';
import {
  CONNECTOR_GRANT_METADATA_COLUMNS,
  connectorManagementErrorToHttp,
  toConnectorConnectionView,
} from '@/lib/connector/connection';
import { connectorError } from '@/lib/connector/errors';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  connectorDisconnectRequestSchema,
  connectorGrantRecordSchema,
} from '@/schemas/connector';
import {
  PRIVATE_NO_STORE,
  readFailureResponse,
  resolveOwnerContext,
} from './connection-helpers';

export async function disconnectConnector(request: NextRequest) {
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
  const parsed = connectorDisconnectRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ...connectorError('INVALID_REQUEST', 'Validation failed.') },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const resolved = await resolveOwnerContext(request, body.merchantId);
  if (!resolved.ok) {
    return resolved.response;
  }
  const { supabase, merchantId } = resolved.context;

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

  const { data: row, error: readError } = await supabase
    .from('connector_grants')
    .select(CONNECTOR_GRANT_METADATA_COLUMNS)
    .eq('id', body.grantId)
    .maybeSingle();
  if (readError) return readFailureResponse();
  const record = connectorGrantRecordSchema.safeParse(row);
  // Cross-merchant ids read as not found: no existence oracle, and the
  // merchant scope check below stays defense in depth.
  if (!record.success || record.data.merchant_id !== merchantId) {
    return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
  }

  const view = toConnectorConnectionView(record.data);
  // Only non-active rows skip the RPC: an expired-but-active grant must
  // still be revoked so the disconnect actually closes it.
  if (record.data.status !== 'active') {
    return NextResponse.json({ grant: view, revoked: false });
  }

  const { data: revoked, error } = await supabase.rpc(
    'revoke_connector_grant',
    { p_grant_id: body.grantId, p_reason: 'merchant disconnect' }
  );
  if (error) {
    const mapped = connectorManagementErrorToHttp(error.message ?? '');
    return NextResponse.json(
      { ...mapped.body },
      { status: mapped.status, headers: PRIVATE_NO_STORE }
    );
  }
  if (!revoked) {
    return NextResponse.json({ grant: view, revoked: false });
  }

  return NextResponse.json({
    grant: { ...view, status: 'revoked' as const, usable: false },
    revoked: true,
  });
}
