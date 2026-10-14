import { authenticateApiRequest } from '@/lib/api-auth';
import {
  type CartRequestContextDeps,
  type CartRequestContextResult,
  resolveCartRequestContext,
} from './request-context';
import {
  type VerifiedCartCustomer,
  verifyCartCustomer,
} from './verified-customer';

/** Customer authentication and cart authority remain independent, including on native. */
export async function resolveAccountCartRequest(
  request: Request,
  deps: CartRequestContextDeps
): Promise<
  | Extract<CartRequestContextResult, { ok: false }>
  | (Extract<CartRequestContextResult, { ok: true }> & {
      customer: VerifiedCartCustomer;
    })
> {
  const explicit = request.headers.get('X-Cart-Session-Proof');
  if (
    explicit !== null &&
    (!explicit.startsWith('cp1.') ||
      explicit.length > 8192 ||
      explicit.split('.').length !== 3)
  )
    return { ok: false, error: 'invalid_proof' };
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return { ok: false, error: 'unauthorized' };
  let cartRequest = request;
  if (explicit !== null) {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${explicit}`);
    // Cart resolution needs URL and headers only; never consume or clone the mutation body.
    cartRequest = new Request(request.url, { headers });
  }
  const context = await resolveCartRequestContext(cartRequest, deps);
  if (!context.ok) return context;
  const customer = await verifyCartCustomer(context.principal, auth);
  if (!customer.ok) return { ok: false, error: customer.code };
  return { ...context, customer: customer.customer };
}
