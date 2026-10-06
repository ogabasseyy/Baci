import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';

type MockAuthError = { message?: string; status?: number } | null;
type MockSessionResult = {
  data: { session: { access_token: string } | null };
  error?: MockAuthError;
};
type MockUserResult = {
  data: { user: { id: string } | null };
  error?: MockAuthError;
};

export const mockFetch = jest.fn<FetchImplementation>();
export const mockGetSession = jest.fn<() => Promise<MockSessionResult>>();
export const mockGetUser = jest.fn<() => Promise<MockUserResult>>();
export const mockLogWarn = jest.fn();
export const mockConfig = {
  MERCHANT_ID: '',
  MERCHANT_SLUG: 'ogabassey',
};

export const legacyQuizEventDefaults = {
  contractVersion: 1,
  maxAttempts: 1,
  mode: 'live',
  resultsPublishedAt: null,
  rulesVersion: null,
  timePerQuestionSeconds: 30,
  timeZone: 'Africa/Lagos',
} as const;

const originalFetch = global.fetch;
global.fetch = mockFetch;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      },
    },
  },
}));

jest.mock('@/lib/config', () => ({ CONFIG: mockConfig }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: mockLogWarn,
  }),
}));

export const mockExpoConstants = require('expo-constants').default as {
  expoConfig?: { extra?: Record<string, unknown> };
};

export const quizService = require('./quiz') as typeof import('./quiz');

export function resetQuizServiceMocks() {
  mockFetch.mockReset();
  mockGetSession.mockReset();
  mockGetUser.mockReset();
  mockLogWarn.mockReset();
  mockExpoConstants.expoConfig = {
    extra: {
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    },
  };
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'token-123' } },
  });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockConfig.MERCHANT_ID = '';
  mockConfig.MERCHANT_SLUG = 'ogabassey';
}

export function restoreQuizServiceGlobals() {
  global.fetch = originalFetch;
}
