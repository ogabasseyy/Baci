import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  readUploadBytes: vi.fn(),
  storageUpload: vi.fn(),
  getPublicUrl: vi.fn(),
  updateEq: vi.fn(),
  update: vi.fn(),
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: mocks.apiClient,
}));

vi.mock('@/lib/upload/readUploadBytes', () => ({
  readUploadBytes: mocks.readUploadBytes,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: mocks.storageUpload,
        getPublicUrl: mocks.getPublicUrl,
      })),
    },
    from: vi.fn(() => ({
      update: mocks.update,
    })),
  },
}));

import {
  uploadDataUriLogoBestEffort,
  uploadPickedLogoBestEffort,
} from './onboarding-chat.logo-upload';

describe('uploadPickedLogoBestEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readUploadBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.storageUpload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://cdn.usebaci.com/media/m-1/logo.png' },
    });
    mocks.updateEq.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.updateEq });
    mocks.apiClient.mockResolvedValue({ ok: true });
  });

  it('uploads the picked logo to storage, persists merchants.logo_url, and generates favicons', async () => {
    await uploadPickedLogoBestEffort(
      {
        uri: 'file:///tmp/store-logo.png',
        fileName: 'store-logo.png',
        mimeType: 'image/png',
      },
      'm-1'
    );

    expect(mocks.readUploadBytes).toHaveBeenCalledWith(
      'file:///tmp/store-logo.png'
    );
    expect(mocks.storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^m-1\/\d+\.png$/),
      expect.any(Uint8Array),
      { contentType: 'image/png', upsert: true }
    );
    expect(mocks.update).toHaveBeenCalledWith({
      logo_url: 'https://cdn.usebaci.com/media/m-1/logo.png',
    });
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'm-1');
    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/merchant/favicon',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does not update logo_url if storage upload returns an error', async () => {
    mocks.storageUpload.mockResolvedValueOnce({
      error: new Error('storage error'),
    });

    await uploadPickedLogoBestEffort(
      {
        uri: 'file:///tmp/store-logo.png',
        fileName: 'store-logo.png',
        mimeType: 'image/png',
      },
      'm-1'
    );

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('decodes and persists an AI-generated data URI logo to merchants.logo_url', async () => {
    await uploadDataUriLogoBestEffort(
      'data:image/png;base64,iVBORw0KGgo=',
      'm-2'
    );

    expect(mocks.storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^m-2\/\d+\.png$/),
      expect.any(Uint8Array),
      { contentType: 'image/png', upsert: true }
    );
    expect(mocks.update).toHaveBeenCalledWith({
      logo_url: 'https://cdn.usebaci.com/media/m-1/logo.png',
    });
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'm-2');
  });
});
