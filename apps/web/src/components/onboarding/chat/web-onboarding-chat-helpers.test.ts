import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAllowedWebLogoFile,
  requestWebOnboardingAssist,
  uploadWebOnboardingLogo,
} from './web-onboarding-chat-helpers';

const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  })),
}));

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: (headers: Record<string, string>) => ({
    ...headers,
    'x-csrf-token': 'test-csrf',
  }),
}));

describe('web-onboarding-chat-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: {
        publicUrl:
          'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-1/logo.png',
      },
    });
  });

  it('allows PNG/JPEG/WebP files and rejects SVG files', () => {
    expect(
      isAllowedWebLogoFile(new File(['x'], 'a.png', { type: 'image/png' }))
    ).toBe(true);
    expect(
      isAllowedWebLogoFile(new File(['x'], 'a.svg', { type: 'image/svg+xml' }))
    ).toBe(false);
  });

  it('uploads raster logos to user-scoped images/onboarding/{userId}/ path and rejects SVG', async () => {
    const svg = new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' });
    await expect(uploadWebOnboardingLogo(svg, 'user-1')).rejects.toThrow(
      'PNG, JPEG, or WebP'
    );

    const png = new File(['abc'], 'logo.png', { type: 'image/png' });
    const url = await uploadWebOnboardingLogo(png, 'user-1');
    expect(url).toContain('/images/onboarding/user-1/');
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^onboarding\/user-1\/\d+-.+\.png$/),
      png,
      expect.objectContaining({ contentType: 'image/png', upsert: true })
    );
  });

  it('sends CSRF headers to /api/onboarding/assist', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ businessNames: ['Kicks Hub'] }), {
        status: 200,
      })
    );

    const result = await requestWebOnboardingAssist({
      task: 'generate_names',
      businessName: '',
      businessType: 'fashion',
      brandPreferences: 'modern',
      description: 'Sneakers',
    });

    expect(result.businessNames).toEqual(['Kicks Hub']);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/onboarding/assist',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'test-csrf' }),
      })
    );
    fetchSpy.mockRestore();
  });
});
