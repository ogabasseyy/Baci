import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const heroImageRouteMocks = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  checkRateLimit: vi.fn(),
  createClient: vi.fn(),
  eq: vi.fn(),
  generateHeroImageBatch: vi.fn(),
  getPlatformAdminAuthForPermission: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  select: vi.fn(),
}));

export function getHeroImageRouteMocks() {
  return heroImageRouteMocks;
}

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: heroImageRouteMocks.checkRateLimit,
}));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission:
    heroImageRouteMocks.getPlatformAdminAuthForPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: heroImageRouteMocks.checkCsrfProtection,
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: heroImageRouteMocks.loggerError,
    info: vi.fn(),
    warn: heroImageRouteMocks.loggerWarn,
  },
}));
vi.mock('@/services/hero-image-generator', () => ({
  generateHeroImageBatch: heroImageRouteMocks.generateHeroImageBatch,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: heroImageRouteMocks.createClient,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));

export function heroImageRequest(body: string) {
  return new NextRequest(
    'http://localhost:3000/api/admin/generate-hero-images',
    {
      body,
      method: 'POST',
    }
  );
}

export function resetHeroImageRouteMocks() {
  vi.clearAllMocks();
  heroImageRouteMocks.checkCsrfProtection.mockResolvedValue({ valid: true });
  heroImageRouteMocks.checkRateLimit.mockResolvedValue(true);
  heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValue({
    status: 'unauthenticated',
  });
  heroImageRouteMocks.eq.mockResolvedValue({ data: [], error: null });
  heroImageRouteMocks.select.mockReturnValue({ eq: heroImageRouteMocks.eq });
  heroImageRouteMocks.createClient.mockReturnValue({
    from: vi.fn().mockReturnValue({ select: heroImageRouteMocks.select }),
  });
  heroImageRouteMocks.generateHeroImageBatch.mockResolvedValue({
    imageIds: ['hero-1', 'hero-2'],
    success: true,
  });
}
