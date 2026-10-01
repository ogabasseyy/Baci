import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickAndUploadFavicon } from './pickAndUploadFavicon';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  createUploadFormData: vi.fn(),
  getSession: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  fetch: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync:
    mocks.requestMediaLibraryPermissionsAsync,
}));

vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));

vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://example.com' }));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

vi.mock('./createUploadFormData', () => ({
  createUploadFormData: mocks.createUploadFormData,
}));

describe('pickAndUploadFavicon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    });
    mocks.launchImageLibraryAsync.mockResolvedValue({
      assets: [
        {
          fileName: 'store-avatar.jpg',
          mimeType: 'image/jpeg',
          uri: 'file:///store-avatar.jpg',
        },
      ],
      canceled: false,
    });
    mocks.createUploadFormData.mockReturnValue(new FormData());
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });
    mocks.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
      ok: true,
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads the selected asset and refreshes merchant data', async () => {
    const setUploading = vi.fn();

    await pickAndUploadFavicon(setUploading, {
      invalidateQueries: mocks.invalidateQueries,
    });

    expect(mocks.createUploadFormData).toHaveBeenCalledWith({
      name: 'store-avatar.jpg',
      type: 'image/jpeg',
      uri: 'file:///store-avatar.jpg',
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.com/api/merchant/favicon',
      expect.objectContaining({
        body: expect.any(FormData),
        headers: { Authorization: 'Bearer test-token' },
        method: 'POST',
      })
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
    expect(mocks.alert).toHaveBeenCalledWith(
      'Success',
      'Favicon updated successfully!'
    );
    expect(setUploading).toHaveBeenNthCalledWith(1, true);
    expect(setUploading).toHaveBeenLastCalledWith(false);
  });

  it('surfaces picker and upload failures instead of failing silently', async () => {
    mocks.launchImageLibraryAsync.mockRejectedValueOnce(
      new Error('Picker unavailable')
    );
    const setUploading = vi.fn();

    await pickAndUploadFavicon(setUploading, {
      invalidateQueries: mocks.invalidateQueries,
    });

    expect(mocks.alert).toHaveBeenCalledWith('Error', 'Picker unavailable');
    expect(setUploading).toHaveBeenLastCalledWith(false);
  });
});
