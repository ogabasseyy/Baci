import { Alert } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialProductEditFormData } from '@/components/product/product-edit.defaults';
import type { ProductEditFormData } from '@/components/product/product-edit.types';

const mocks = vi.hoisted(() => ({
  getPublicUrl: vi.fn(),
  fetch: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

vi.mock('expo-image-picker', () => ({
  launchCameraAsync: mocks.launchCameraAsync,
  launchImageLibraryAsync: mocks.launchImageLibraryAsync,
  requestCameraPermissionsAsync: mocks.requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync:
    mocks.requestMediaLibraryPermissionsAsync,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: mocks.getPublicUrl,
        upload: mocks.upload,
      }),
    },
  },
}));

import { createProductEditImageActions } from './createProductEditImageActions';

type SetFormDataUpdater =
  | ProductEditFormData
  | ((previous: ProductEditFormData) => ProductEditFormData);

function createFormDataSetter() {
  let nextFormData: ProductEditFormData = createInitialProductEditFormData();
  const setFormData = vi.fn((updater: SetFormDataUpdater) => {
    nextFormData =
      typeof updater === 'function' ? updater(nextFormData) : updater;
  });
  return {
    get formData() {
      return nextFormData;
    },
    setFormData,
  };
}

async function triggerLibraryFlow() {
  const alertArgs = vi.mocked(Alert.alert).mock.calls[0];
  const button = alertArgs?.[2]?.find(
    (entry) => entry.text === 'Choose from Library'
  );
  expect(button).toBeDefined();
  await button?.onPress?.();
}

async function triggerCameraFlow() {
  const alertArgs = vi.mocked(Alert.alert).mock.calls[0];
  const button = alertArgs?.[2]?.find((entry) => entry.text === 'Take Photo');
  expect(button).toBeDefined();
  await button?.onPress?.();
}

describe('createProductEditImageActions', () => {
  const selectedImageBytes = new ArrayBuffer(8);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://example.com/product.jpg' },
    });
    mocks.launchImageLibraryAsync.mockResolvedValue({
      assets: [{ uri: 'file:///product.jpg' }],
      canceled: false,
    });
    mocks.launchCameraAsync.mockResolvedValue({
      assets: [{ uri: 'file:///camera.jpg' }],
      canceled: false,
    });
    mocks.requestCameraPermissionsAsync.mockResolvedValue({
      status: 'granted',
    });
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: 'granted',
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.fetch.mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(selectedImageBytes),
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads the selected image and appends the public URL', async () => {
    const store = createFormDataSetter();
    const setIsUploading = vi.fn();
    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: store.setFormData,
      setIsUploading,
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(mocks.upload).toHaveBeenCalled();
    expect(store.formData.images).toEqual(['https://example.com/product.jpg']);
    expect(setIsUploading).toHaveBeenNthCalledWith(1, true);
    expect(setIsUploading).toHaveBeenLastCalledWith(false);
  });

  it('uploads image bytes instead of unsupported React Native FormData', async () => {
    const store = createFormDataSetter();
    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: store.setFormData,
      setIsUploading: vi.fn(),
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(mocks.fetch).toHaveBeenCalledWith('file:///product.jpg');
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^merchant-1\/products\/\d+\.jpg$/),
      selectedImageBytes,
      { contentType: 'image/jpeg', upsert: true }
    );
  });

  it('alerts and clears uploading state when the upload fails', async () => {
    mocks.upload.mockResolvedValueOnce({ error: new Error('boom') });

    const store = createFormDataSetter();
    const setIsUploading = vi.fn();
    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: store.setFormData,
      setIsUploading,
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(mocks.upload).toHaveBeenCalled();
    expect(store.formData.images).toEqual([]);
    expect(setIsUploading).toHaveBeenLastCalledWith(false);
    const errorCall = vi
      .mocked(Alert.alert)
      .mock.calls.find(([title]) => title === 'Error');
    expect(errorCall).toBeDefined();
  });

  it('does not upload when the user cancels the library picker', async () => {
    mocks.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true });

    const store = createFormDataSetter();
    const setIsUploading = vi.fn();
    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: store.setFormData,
      setIsUploading,
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(store.setFormData).not.toHaveBeenCalled();
    expect(setIsUploading).not.toHaveBeenCalled();
  });

  it('alerts and skips uploading when camera permission is denied', async () => {
    mocks.requestCameraPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
    });

    const store = createFormDataSetter();
    const setIsUploading = vi.fn();
    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: store.setFormData,
      setIsUploading,
    });

    actions.handleImagePick();
    await triggerCameraFlow();

    expect(mocks.launchCameraAsync).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(setIsUploading).not.toHaveBeenCalled();
    const denialCall = vi
      .mocked(Alert.alert)
      .mock.calls.find(([title]) => title === 'Permission Denied');
    expect(denialCall).toBeDefined();
  });

  it('alerts and skips uploading when media library permission is denied', async () => {
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
    });

    const store = createFormDataSetter();
    const setIsUploading = vi.fn();
    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: store.setFormData,
      setIsUploading,
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(mocks.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(setIsUploading).not.toHaveBeenCalled();
    const denialCall = vi
      .mocked(Alert.alert)
      .mock.calls.find(([title]) => title === 'Permission Denied');
    expect(denialCall).toBeDefined();
  });

  it('surfaces image-picker failures instead of silently rejecting', async () => {
    mocks.launchImageLibraryAsync.mockRejectedValueOnce(
      new Error('picker unavailable')
    );

    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: vi.fn(),
      setIsUploading: vi.fn(),
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Image Selection Failed',
      'picker unavailable'
    );
  });

  it('alerts when a picker returns no asset without cancellation', async () => {
    mocks.launchImageLibraryAsync.mockResolvedValueOnce({
      assets: [],
      canceled: false,
    });

    const actions = createProductEditImageActions({
      merchantId: 'merchant-1',
      setFormData: vi.fn(),
      setIsUploading: vi.fn(),
    });

    actions.handleImagePick();
    await triggerLibraryFlow();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Image Selection Failed',
      'No image was selected. Please try again.'
    );
  });

  it('does not open a picker when the merchant context is missing', () => {
    const actions = createProductEditImageActions({
      merchantId: undefined,
      setFormData: vi.fn(),
      setIsUploading: vi.fn(),
    });

    actions.handleImagePick();

    expect(mocks.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Your store is not ready for image uploads. Please try again.'
    );
  });
});
