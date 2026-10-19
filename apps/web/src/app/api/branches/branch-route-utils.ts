import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { requestedMerchantIdSchema } from '@/schemas/branches';

const BRANCH_LIST_BASE_COLUMNS = `
  id,
  merchant_id,
  name,
  address,
  city,
  state,
  phone,
  manager_id,
  is_default,
  active,
  created_at,
  updated_at
`.trim();

export const BRANCH_LIST_COLUMNS = BRANCH_LIST_BASE_COLUMNS;

const BRANCH_BASE_COLUMNS = `
  ${BRANCH_LIST_BASE_COLUMNS},
  staff_members:manager_id (
    id,
    name,
    email
  )
`.trim();

export const BRANCH_COLUMNS = BRANCH_BASE_COLUMNS;

export const BRANCH_DETAIL_COLUMNS = `
  ${BRANCH_BASE_COLUMNS},
  virtual_terminals (
    id,
    code,
    name,
    account_number,
    active
  )
`.trim();

export function parseRequestedMerchantId(request: Request) {
  const value = request.headers.get('x-baci-merchant-id');
  if (!value) {
    return { merchantId: null, response: null };
  }

  const parsed = requestedMerchantIdSchema.safeParse(value);
  if (!parsed.success) {
    return {
      merchantId: null,
      response: NextResponse.json(
        { error: 'Invalid merchant context' },
        { status: 400 }
      ),
    };
  }

  return { merchantId: parsed.data, response: null };
}

export function mapBranchMutationError(
  error: {
    code?: string;
    constraint?: string;
    details?: string;
    message?: string;
  } | null,
  fallback: string
) {
  if (!error) {
    return NextResponse.json({ error: fallback }, { status: 500 });
  }

  if (error.code === '02000' || error.code === 'PGRST116') {
    console.error('[Branches] Branch not found:', error);
    return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
  }

  if (error.code === '42501') {
    console.error('[Branches] Forbidden branch mutation:', error);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const lowerMessage = error.message?.toLowerCase() ?? '';
  const lowerDetails = error.details?.toLowerCase() ?? '';
  if (isDefaultBranchConflictError(error)) {
    console.warn('[Branches] Default branch conflict:', error);
    return NextResponse.json(
      { error: 'Default branch conflict' },
      { status: 409 }
    );
  }

  if (error.code === '23505') {
    console.warn('[Branches] Unique branch conflict:', error);
    return NextResponse.json({ error: 'Conflict' }, { status: 409 });
  }

  const isOnlyActiveBranchGuard =
    error.constraint === 'branches_require_active_branch' ||
    lowerDetails.includes('only active branch') ||
    lowerMessage.includes('only active branch');

  if (error.code === '23514' && isOnlyActiveBranchGuard) {
    // The migration raises branches_require_active_branch; keep message checks
    // as compatibility for databases that have not applied that revision yet.
    console.error(
      '[Branches] Only-active branch guard rejected mutation:',
      error
    );
    return NextResponse.json(
      { error: 'Cannot deactivate the only active branch' },
      { status: 409 }
    );
  }

  if (error.code === '23514') {
    console.error('[Branches] Invalid branch mutation:', error);
    return NextResponse.json(
      { error: 'Invalid branch mutation' },
      { status: 400 }
    );
  }

  console.error('[Branches] Unhandled mutation error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function isDefaultBranchConflictError(
  error:
    | {
        code?: string;
        constraint?: string;
        details?: string;
        message?: string;
      }
    | null
    | undefined
) {
  if (error?.code !== '23505') {
    return false;
  }

  const lowerMessage = error.message?.toLowerCase() ?? '';
  const lowerDetails = error.details?.toLowerCase() ?? '';

  return (
    error.constraint === 'idx_branches_one_active_default_per_merchant' ||
    lowerDetails.includes('idx_branches_one_active_default_per_merchant') ||
    lowerMessage.includes('idx_branches_one_active_default_per_merchant')
  );
}

export async function authenticateAndResolveMerchant(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    if (auth.error) {
      console.error('[Branches] Authentication failed');
    }

    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      supabase: null,
      merchantContext: null,
    };
  }

  const requestedMerchant = parseRequestedMerchantId(request);
  if (requestedMerchant.response) {
    return {
      response: requestedMerchant.response,
      supabase: null,
      merchantContext: null,
    };
  }

  const merchantContext = await getMerchantForApiRequest(
    auth.supabase,
    auth.user.id,
    { requestedMerchantId: requestedMerchant.merchantId }
  );
  if (!merchantContext) {
    return {
      response: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      ),
      supabase: null,
      merchantContext: null,
    };
  }

  return {
    response: null,
    supabase: auth.supabase,
    merchantContext,
  };
}
