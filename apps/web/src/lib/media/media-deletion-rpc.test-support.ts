import { vi } from 'vitest';
export function createMediaDeletionRpcMock() {
  return vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === 'claim_merchant_media_deletion_batch') {
      const identities = Array.isArray(args.p_identities)
        ? args.p_identities
        : [];
      return Promise.resolve({
        data: identities.map((value: unknown) => {
          const identity = String(value);
          return {
            path: identity.includes('/')
              ? identity
              : `${args.p_merchant_id}/${identity}`,
            state: 'pending',
            object_id: '36690000-0000-4000-8000-000000000002',
          };
        }),
        error: null,
      });
    }
    return Promise.resolve({ data: true, error: null });
  });
}
