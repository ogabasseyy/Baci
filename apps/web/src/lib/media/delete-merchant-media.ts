import { mediaDeletionAdmissionSchema } from '@/schemas/media-deletion-rpc';
export type MediaDeletionClient = {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: unknown }>;
    };
  };
};
type Failure = {
  status: 400 | 403 | 404 | 409 | 503;
  body: { code: string; error: string };
};
const pending: Failure = {
  status: 503,
  body: {
    code: 'media_delete_pending',
    error: 'Deletion is pending. Retry to finish removing this file.',
  },
};
function denied(error: unknown): Failure {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? error.message
      : null;
  if (message === 'media_in_use')
    return {
      status: 409,
      body: {
        code: 'media_in_use',
        error:
          'This file is still in use. Remove its saved references before deleting it.',
      },
    };
  if (message === 'media_forbidden')
    return {
      status: 403,
      body: { code: 'media_forbidden', error: 'Access denied' },
    };
  if (message === 'media_not_found')
    return {
      status: 404,
      body: { code: 'media_not_found', error: 'File not found' },
    };
  return {
    status: 503,
    body: {
      code: 'media_reference_check_unavailable',
      error: 'Unable to verify whether this file can be deleted. Retry later.',
    },
  };
}
/** Normal authenticated client only. Admission is durable before Storage removal. */
export async function deleteMerchantMedia(input: {
  client: MediaDeletionClient;
  merchantId: string;
  identities: string[];
}): Promise<Failure | null> {
  const paths = new Set<string>();
  try {
    const { data, error: admissionError } = await input.client.rpc(
      'claim_merchant_media_deletion_batch',
      { p_merchant_id: input.merchantId, p_identities: input.identities }
    );
    if (admissionError) return denied(admissionError);
    const parsed = mediaDeletionAdmissionSchema.safeParse(data);
    if (!parsed.success || parsed.data.length !== input.identities.length)
      return denied(null);
    for (const row of parsed.data) {
      if (
        !row.path.startsWith(`${input.merchantId}/`) ||
        row.path.includes('..')
      )
        return denied(null);
      if (row.state === 'pending') paths.add(row.path);
    }
    if (paths.size === 0) return null;
    const { error } = await input.client.storage
      .from('media')
      .remove([...paths]);
    if (error) return pending;
    for (const path of paths) {
      const completed = await input.client.rpc(
        'complete_merchant_media_deletion',
        { p_merchant_id: input.merchantId, p_path: path }
      );
      if (completed.error || completed.data !== true) return pending;
    }
    return null;
  } catch {
    return paths.size > 0 ? pending : denied(null);
  }
}
