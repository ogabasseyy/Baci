import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isUserScopedOnboardingLogoUrl } from './onboarding-logo-url';

describe('isUserScopedOnboardingLogoUrl', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  });

  it('accepts raster image storage URLs under the caller user folder', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      expect(
        isUserScopedOnboardingLogoUrl(
          `https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/logo.${ext}`,
          'user-123'
        )
      ).toBe(true);
    }
  });

  it('rejects non-raster files, another user folder, external origins, missing filename, or missing env', () => {
    expect(
      isUserScopedOnboardingLogoUrl(
        'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/logo.svg',
        'user-123'
      )
    ).toBe(false);
    expect(
      isUserScopedOnboardingLogoUrl(
        'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/page.html',
        'user-123'
      )
    ).toBe(false);
    expect(
      isUserScopedOnboardingLogoUrl(
        'https://project.supabase.co/storage/v1/object/public/images/onboarding/other-user/logo.png',
        'user-123'
      )
    ).toBe(false);
    expect(
      isUserScopedOnboardingLogoUrl(
        'https://evil.example/storage/v1/object/public/images/onboarding/user-123/logo.png',
        'user-123'
      )
    ).toBe(false);
    expect(
      isUserScopedOnboardingLogoUrl(
        'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/',
        'user-123'
      )
    ).toBe(false);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(
      isUserScopedOnboardingLogoUrl(
        'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/logo.png',
        'user-123'
      )
    ).toBe(false);
  });
});
