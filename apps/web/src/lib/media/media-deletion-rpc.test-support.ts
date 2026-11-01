import { vi } from 'vitest';
export function createMediaDeletionRpcMock() {
  return vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === 'claim_merchant_media_deletion') {
      const identity = String(args.p_identity);
      const path = identity.includes('/')
        ? identity
        : `${args.p_merchant_id}/${identity}`;
      return Promise.resolve({
        data: [
          {
            path,
            state: 'pending',
            object_id: '36690000-0000-4000-8000-000000000002',
          },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: true, error: null });
  });
}
