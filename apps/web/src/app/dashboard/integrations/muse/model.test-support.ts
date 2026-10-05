import { vi } from 'vitest';
import type { useMuseConnections } from './use-muse-connections';

type Model = ReturnType<typeof useMuseConnections>;
export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    merchant: null,
    loading: false,
    isOwner: true,
    status: { connections: [] },
    statusError: null,
    branches: [],
    scopes: ['orders:read'],
    merchantWide: true,
    branchIds: [],
    expiry: '2592000',
    connecting: false,
    disconnecting: null,
    confirmingDisconnect: null,
    credentials: null,
    setMerchantWide: vi.fn(),
    setExpiry: vi.fn(),
    setConfirmingDisconnect: vi.fn(),
    toggleScope: vi.fn(),
    toggleBranch: vi.fn(),
    handleConnect: vi.fn().mockResolvedValue(undefined),
    handleDisconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
