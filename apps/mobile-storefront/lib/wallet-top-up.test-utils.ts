import { beforeEach, jest } from '@jest/globals';

export type MockFetchResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<Record<string, unknown>>;
};

type MockUserResult = {
  data: { user: { id: string } | null };
  error: Error | null;
};

type MockSessionResult = {
  data: {
    session: {
      access_token: string;
      expires_at?: number;
      user?: { id: string };
    } | null;
  };
  error: Error | null;
};

export const mockFetchWithTimeout =
  jest.fn<(...args: unknown[]) => Promise<MockFetchResponse>>();
export const mockGetUser = jest.fn<() => Promise<MockUserResult>>();
export const mockGetSession = jest.fn<() => Promise<MockSessionResult>>();

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://usebaci.com',
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_SLUG: 'demo-store',
  },
}));

jest.mock('@/lib/fetch-with-timeout', () => ({
  DEFAULT_TIMEOUT: 30000,
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      getUser: () => mockGetUser(),
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: { access_token: 'token-123', user: { id: 'user-1' } },
    },
    error: null,
  });
});
