import type { SupabaseClient } from '@supabase/supabase-js';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  experienceApprovalId,
  experienceApprovalPost,
} from '@/schemas/experience-publication';
import { VerifierTemporarilyUnavailable } from './verifier-availability';
export interface OwnerApprovalDependencies {
  ownerClient(request: Request): Promise<SupabaseClient | null>;
  checkMutation(request: Request): Promise<Response | null>;
  load(client: SupabaseClient, id: string): Promise<unknown>;
  prepareDraft?(
    client: SupabaseClient,
    id: string,
    signal?: AbortSignal
  ): Promise<unknown>;
  preparePublication?(
    client: SupabaseClient,
    id: string,
    signal?: AbortSignal
  ): Promise<unknown>;
  confirm(
    client: SupabaseClient,
    id: string,
    signal?: AbortSignal
  ): Promise<unknown>;
  loadLifecycle?(client: SupabaseClient, id: string): Promise<unknown>;
  confirmPublication?(
    client: SupabaseClient,
    id: string,
    signal?: AbortSignal
  ): Promise<unknown>;
  confirmModeExit?(
    client: SupabaseClient,
    id: string,
    signal?: AbortSignal
  ): Promise<unknown>;
}
/** No install side effects and no provider imports. The route supplies normal auth. */
export function createOwnerApprovalHandler(deps: OwnerApprovalDependencies) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    try {
      const owner = await deps.ownerClient(request);
      if (!owner)
        return respond({ error: 'Sign in to review this approval.' }, 401);
      if (request.method === 'GET') {
        const parsed = experienceApprovalId.safeParse(
          new URL(request.url).searchParams.get('approval')
        );
        if (!parsed.success)
          return respond({ error: 'Invalid approval request.' }, 400);
        const kind = new URL(request.url).searchParams.get('kind') ?? 'draft';
        if (kind !== 'draft' && kind !== 'lifecycle')
          return respond({ error: 'Invalid approval request.' }, 400);
        const load = kind === 'draft' ? deps.load : deps.loadLifecycle;
        if (!load) return respond({ error: 'Approval unavailable.' }, 503);
        return respond(await load(owner, parsed.data));
      }
      if (request.method !== 'POST')
        return respond({ error: 'Method not allowed.' }, 405);
      const csrf = await deps.checkMutation(request);
      if (csrf) return respond({ error: 'Forbidden' }, csrf.status);
      const body = await readBoundedJsonBody(request, 4096);
      if (!body.ok)
        return respond(
          { error: 'Invalid approval request.' },
          body.reason === 'too_large' ? 413 : 400
        );
      const parsed = experienceApprovalPost.safeParse(body.body);
      if (!parsed.success)
        return respond({ error: 'Invalid approval request.' }, 400);
      if (
        parsed.data.action === 'prepare-draft' ||
        parsed.data.action === 'prepare-publication'
      ) {
        const prepare =
          parsed.data.action === 'prepare-draft'
            ? deps.prepareDraft
            : deps.preparePublication;
        if (!prepare)
          return respond({ error: 'Approval preparation unavailable.' }, 503);
        request.signal.throwIfAborted();
        return respond(
          await prepare(owner, parsed.data.approvalId, request.signal)
        );
      }
      const confirm =
        parsed.data.action === 'confirm-draft'
          ? deps.confirm
          : parsed.data.action === 'confirm-publication'
            ? deps.confirmPublication
            : deps.confirmModeExit;
      if (!confirm) return respond({ error: 'Approval unavailable.' }, 503);
      request.signal.throwIfAborted();
      return respond(
        await confirm(owner, parsed.data.approvalId, request.signal)
      );
    } catch (error) {
      const status =
        error instanceof VerifierTemporarilyUnavailable ? 503 : 403;
      return respond({ error: 'Approval unavailable.' }, status);
    }
  };
}
