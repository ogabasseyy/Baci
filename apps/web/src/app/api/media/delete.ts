import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { deleteMerchantMedia } from '@/lib/media/delete-merchant-media';
import { createClient } from '@/lib/supabase/server';
import { mediaDeletionIdentitySchema } from '@/schemas/media-deletion';
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  const identity = new URL(request.url).searchParams.get('id');
  if (!identity)
    return NextResponse.json({ error: 'File ID required' }, { status: 400 });
  const parsed = mediaDeletionIdentitySchema.safeParse(identity);
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid File ID' }, { status: 400 });
  const merchant = await getMerchantForApiRequest(supabase, user.id);
  if (!merchant)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(toUserAccess(merchant), 'products', 'delete'))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const failure = await deleteMerchantMedia({
    client: supabase,
    merchantId: merchant.merchantId,
    identities: [parsed.data],
  });
  if (failure)
    return NextResponse.json(failure.body, { status: failure.status });
  return NextResponse.json({ success: true });
}
