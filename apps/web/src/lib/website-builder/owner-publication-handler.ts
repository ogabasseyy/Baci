import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { builderError } from '@/lib/builder-connector/errors';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { publicationPostSchema } from '@/schemas/builder-publication';
import {
  confirmStorefrontPublication,
  type PublicationRenderVerifier,
} from './commit-publication';
import { loadPublishConfirmation } from './load-publication';
import { DraftServiceError } from './mutation-authorization';
import {
  type PublicationDeliveryDependencies,
  retryCommittedDelivery,
} from './retry-delivery';
export interface OwnerPublicationDependencies
  extends PublicationRenderVerifier {
  ownerClient: (request: Request) => Promise<SupabaseClient | null>;
  checkMutation: (request: Request) => Promise<Response | null>;
  delivery: PublicationDeliveryDependencies;
}
export function createOwnerPublicationHandler(
  deps: OwnerPublicationDependencies
) {
  return async (request: Request) => {
    const respond = (value: unknown, status = 200) =>
      Response.json(value, {
        status,
        headers: {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    try {
      const owner = await deps.ownerClient(request);
      if (!owner)
        return respond(
          { error: 'Sign in to Baci to review this publication.' },
          401
        );
      if (request.method === 'GET') {
        const intent = z
          .uuid()
          .safeParse(new URL(request.url).searchParams.get('intent'));
        if (!intent.success)
          return respond(builderError('INVALID_REQUEST'), 400);
        return respond(await loadPublishConfirmation(owner, intent.data));
      }
      if (request.method !== 'POST')
        return respond(builderError('INVALID_REQUEST'), 405);
      const csrf = await deps.checkMutation(request);
      if (csrf) {
        csrf.headers.set('Cache-Control', 'private, no-store');
        csrf.headers.set('Referrer-Policy', 'no-referrer');
        return csrf;
      }
      const body = await readBoundedJsonBody(request, 4096);
      if (!body.ok)
        return respond(
          builderError('INVALID_REQUEST'),
          body.reason === 'too_large' ? 413 : 400
        );
      const parsed = publicationPostSchema.safeParse(body.body);
      if (!parsed.success) return respond(builderError('INVALID_REQUEST'), 400);
      const result =
        parsed.data.action === 'confirm'
          ? await confirmStorefrontPublication(
              owner,
              parsed.data.intentId,
              deps
            )
          : await retryCommittedDelivery(
              owner,
              parsed.data.receiptId,
              deps.delivery,
              true
            );
      return respond(result);
    } catch (error) {
      const code =
        error instanceof DraftServiceError ? error.code : 'OPERATION_FAILED';
      return respond(
        builderError(code),
        code === 'NOT_FOUND'
          ? 404
          : code === 'CONNECTION_REVOKED'
            ? 401
            : code === 'INSUFFICIENT_SCOPE'
              ? 403
              : code === 'OPERATION_FAILED'
                ? 503
                : 400
      );
    }
  };
}
