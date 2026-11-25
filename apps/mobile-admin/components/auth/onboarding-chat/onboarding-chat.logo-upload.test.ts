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
  UIImagePickerPreferredAssetRepresentationMode: {
    Automatic: 'automatic',
    Compatible: 'compatible',
    Current: 'current',
  },
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

import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import {
  extractAndPersistUploadedLogoColors,
  persistProvisionedStoreLogo,
  pickOnboardingLogo,
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
    const persisted = await uploadDataUriLogoBestEffort(
      'data:image/png;base64,iVBORw0KGgo=',
      'm-2'
    );

    expect(persisted).toBe('https://cdn.usebaci.com/media/m-1/logo.png');
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

  it('returns null and logs a warning when merchants.logo_url update fails', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mocks.updateEq.mockResolvedValueOnce({
      error: { message: 'RLS violation' },
    });

    const persisted = await uploadPickedLogoBestEffort(
      {
        uri: 'file:///tmp/store-logo.png',
        fileName: 'store-logo.png',
        mimeType: 'image/png',
      },
      'm-3'
    );

    expect(persisted).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'Onboarding merchant logo_url update failed:',
      'RLS violation'
    );
    warnSpy.mockRestore();
  });

  it('extracts and persists brand_colors for an uploaded logo URL', async () => {
    mocks.apiClient.mockResolvedValueOnce({
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    await extractAndPersistUploadedLogoColors({
      logoUrl: 'https://cdn.usebaci.com/media/m-1/logo.png',
      merchantId: 'm-1',
      businessName: 'SoleLux',
      businessType: 'fashion',
    });

    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/mobile/onboarding-assist',
      expect.objectContaining({
        method: 'POST',
        timeout: 55_000,
      })
    );
    expect(mocks.update).toHaveBeenCalledWith({
      brand_colors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'm-1');
  });

  it('rejects picked SVG logos and alerts the user instead of returning an uploadable asset', async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync
    ).mockResolvedValueOnce({ granted: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///tmp/evil.svg',
          fileName: 'evil.svg',
          mimeType: 'image/svg+xml',
        },
      ],
    } as never);

    const picked = await pickOnboardingLogo();

    expect(picked).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unsupported Format',
      expect.stringContaining('PNG, JPEG, or WebP')
    );
  });

  it('requests a compatible iOS asset representation so HEIC iPhone photos convert to JPEG', async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync
    ).mockResolvedValueOnce({ granted: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///tmp/IMG_1234.jpg',
          fileName: 'IMG_1234.jpg',
          mimeType: 'image/jpeg',
        },
      ],
    } as never);

    const picked = await pickOnboardingLogo();

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      })
    );
    expect(picked).toEqual({
      uri: 'file:///tmp/IMG_1234.jpg',
      fileName: 'IMG_1234.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('rejects non-raster MIME types in uploadPickedLogoBestEffort without uploading', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const result = await uploadPickedLogoBestEffort(
      {
        uri: 'file:///tmp/evil.svg',
        fileName: 'evil.svg',
        mimeType: 'image/svg+xml',
      },
      'm-1'
    );

    expect(result).toBeNull();
    expect(mocks.storageUpload).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns false in persistProvisionedStoreLogo for an unpersisted local URI without a matching picked asset', async () => {
    const persisted = await persistProvisionedStoreLogo({
      merchantId: 'm-1',
      logoUrl: 'file:///tmp/orphan-logo.png',
      pickedAsset: null,
      businessName: 'SoleLux',
      businessType: 'fashion',
    });

    expect(persisted).toBe(false);
  });

  it('rejects SVG data URIs in uploadDataUriLogoBestEffort without uploading', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const persisted = await uploadDataUriLogoBestEffort(
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'm-2'
    );

    expect(persisted).toBeNull();
    expect(mocks.storageUpload).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
