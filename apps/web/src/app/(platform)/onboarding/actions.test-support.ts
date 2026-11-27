import { vi } from 'vitest';

const mocks = {
  getAppUrl: vi.fn(),
  getConfiguredAppUrl: vi.fn(),
  getRootDomain: vi.fn(),
  isProduction: vi.fn(),
  ensureActionRateLimit: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithOtp: vi.fn(),
  adminInsert: vi.fn(),
  adminUpdate: vi.fn(),
  adminSelect: vi.fn(),
  adminMaybeSingle: vi.fn(),
  adminSingle: vi.fn(),
  adminEq: vi.fn(),
  adminFrom: vi.fn(),
  adminRpc: vi.fn(),
  ensureOnboardingDomain: vi.fn(),
  provisionCuratedHomepage: vi.fn(),
  loggerError: vi.fn(),
  generateInitialTemplate: vi.fn(),
  aiJobsInsert: vi.fn(),
};
export function getActionMocks() {
  return mocks;
}
const serverClient = {
  auth: {
    getUser: mocks.getUser,
    signInWithPassword: mocks.signInWithPassword,
    signUp: mocks.signUp,
    signOut: mocks.signOut,
    signInWithOtp: mocks.signInWithOtp,
  },
  from: mocks.adminFrom,
  rpc: mocks.adminRpc,
};
vi.doMock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ getAll: () => [], get: () => null, set: vi.fn() }),
}));
vi.doMock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => serverClient),
}));
vi.doMock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.ensureActionRateLimit,
}));
vi.doMock('@/env', () => ({
  getAppUrl: mocks.getAppUrl,
  getConfiguredAppUrl: mocks.getConfiguredAppUrl,
  getRootDomain: mocks.getRootDomain,
  isProduction: mocks.isProduction,
}));
vi.doMock('@/lib/email', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.doMock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: mocks.loggerError, warn: vi.fn() },
}));
vi.doMock('./ensure-onboarding-domain', () => ({
  ensureOnboardingDomain: mocks.ensureOnboardingDomain,
}));
vi.doMock('@/lib/storefront-defaults/provision-curated-homepage', () => ({
  provisionCuratedHomepage: mocks.provisionCuratedHomepage,
}));
export const validFields = {
  email: 'merchant@example.com',
  password: 'StrongP@ss123!',
  confirmPassword: 'StrongP@ss123!',
  businessName: 'TestStore',
  businessType: 'fashion',
  country: 'NG',
  logoUrl:
    'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/logo.png',
  brandColors: JSON.stringify({
    primary: '#000000',
    background: '#ffffff',
    accent: '#F59E0B',
  }),
};
export const prevState = { success: false, message: '' };
const updatedAt = '2026-04-28T10:00:00.000Z';
export function makeFormData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
export function setupActionMocks() {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  mocks.ensureActionRateLimit.mockResolvedValue(true);
  mocks.getAppUrl.mockReturnValue('http://localhost:3000');
  mocks.getConfiguredAppUrl.mockReturnValue('https://usebaci.com');
  mocks.getRootDomain.mockReturnValue('usebaci.com');
  mocks.isProduction.mockReturnValue(false);
  mocks.ensureOnboardingDomain.mockResolvedValue({ status: 'created' });
  mocks.provisionCuratedHomepage.mockResolvedValue({
    status: 'created',
    updatedAt,
  });
  mocks.adminRpc.mockResolvedValue({ data: null, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.signInWithPassword.mockResolvedValue({
    data: null,
    error: { message: 'Invalid login credentials' },
  });
  mocks.signUp.mockResolvedValue({
    data: {
      user: { id: 'user-123', email: 'merchant@example.com' },
      session: { access_token: 'test-token' },
    },
    error: null,
  });
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.adminFrom.mockImplementation((table: string) =>
    table === 'merchants'
      ? {
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({ maybeSingle: mocks.adminMaybeSingle }),
          }),
          insert: mocks.adminInsert,
          update: mocks.adminUpdate,
        }
      : {}
  );
}
export async function submitOnboarding(
  prevState: { message: string; success: boolean },
  formData: FormData
) {
  return (await import('./actions')).submitOnboarding(prevState, formData);
}
export async function sendMagicLink(email: string) {
  return (await import('./actions')).sendMagicLink(email);
}
export function setupChainedMock(
  finalData: unknown,
  finalError: unknown = null
) {
  mocks.adminSingle.mockResolvedValue({ data: finalData, error: finalError });
  mocks.adminSelect.mockReturnValue({ single: mocks.adminSingle });
  mocks.adminInsert.mockReturnValue({ select: mocks.adminSelect });
  mocks.adminEq.mockReturnValue({
    eq: vi.fn(() => ({ select: mocks.adminSelect })),
    select: mocks.adminSelect,
  });
  mocks.adminUpdate.mockReturnValue({ eq: mocks.adminEq });
}
export { updatedAt };
