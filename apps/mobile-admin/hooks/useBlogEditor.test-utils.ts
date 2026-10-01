import type { RefObject } from 'react';
import type { WebView } from 'react-native-webview';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  back: vi.fn(),
  from: vi.fn(),
  getSession: vi.fn(),
  injectJavaScript: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  merchantId: 'merchant-1',
  requestMediaLibraryPermissionsAsync: vi.fn(),
  selectEqId: vi.fn(),
  selectEqMerchant: vi.fn(),
  selectSingle: vi.fn(),
  update: vi.fn(),
  updateEqId: vi.fn(),
  updateEqMerchant: vi.fn(),
  updateSelect: vi.fn(),
  updateSingle: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: {
    back: mocks.back,
  },
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync:
    mocks.requestMediaLibraryPermissionsAsync,
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: {
    alert: mocks.alert,
  },
}));

vi.mock('@/lib/upload/createUploadFormData', () => ({
  createUploadFormData: vi.fn().mockReturnValue(new FormData()),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
    },
    from: mocks.from,
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    isLoading: false,
    merchant: mocks.merchantId ? { id: mocks.merchantId } : null,
  }),
}));

import { useBlogEditor } from '@/hooks/useBlogEditor';

function createWebViewRef(): RefObject<WebView | null> {
  return {
    current: {
      injectJavaScript: mocks.injectJavaScript,
    } as unknown as WebView,
  };
}

function reset() {
  vi.clearAllMocks();
  mocks.merchantId = 'merchant-1';

  mocks.selectSingle.mockResolvedValue({
    data: { content: '<p>Hello world</p>' },
    error: null,
  });
  mocks.selectEqMerchant.mockReturnValue({
    single: mocks.selectSingle,
  });
  mocks.selectEqId.mockReturnValue({
    eq: mocks.selectEqMerchant,
  });
  mocks.updateSingle.mockResolvedValue({
    data: { id: 'post-1' },
    error: null,
  });
  mocks.updateSelect.mockReturnValue({
    single: mocks.updateSingle,
  });
  mocks.updateEqMerchant.mockReturnValue({
    select: mocks.updateSelect,
  });
  mocks.updateEqId.mockReturnValue({
    eq: mocks.updateEqMerchant,
  });
  mocks.from.mockReturnValue({
    select: () => ({
      eq: mocks.selectEqId,
    }),
    update: mocks.update,
  });
  mocks.update.mockReturnValue({
    eq: mocks.updateEqId,
  });

  mocks.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'token',
      },
    },
    error: null,
  });
}

export const useBlogEditorTestUtils = {
  createWebViewRef,
  mocks,
  reset,
  useBlogEditor,
};
