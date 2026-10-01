import type React from 'react';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  deleteFn: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  supabaseFrom: vi.fn(),
  updateFn: vi.fn(),
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Alert: { alert: mocks.alert },
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      React.createElement('button', { onClick: onPress, disabled }, children),
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (text: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('expo-router', () => ({
  router: { back: mocks.routerBack, push: mocks.routerPush },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
}));

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return {
    Ionicons: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
    default: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
    __esModule: true,
  };
});

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock('@/components/ui/InvalidRouteScreen', () => ({
  InvalidRouteScreen: () => null,
}));

vi.mock('@/components/ui/SafeImage', () => ({ default: () => null }));

vi.mock('@/constants/theme', () => ({
  RADIUS: { md: 8, lg: 12 },
  SPACING: { sm: 4, md: 8, lg: 16 },
  TYPOGRAPHY: {
    size: { xs: 10, sm: 12, md: 14, lg: 16 },
    fontFamily: {
      regular: 'System',
      medium: 'System',
      semiBold: 'System',
      bold: 'System',
    },
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-abc-123' } }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      text: '#000',
      textSecondary: '#666',
      textMuted: '#999',
      primary: '#0070f3',
      primaryLight: '#e6f0ff',
      card: '#fff',
      border: '#eee',
      error: '#f00',
      errorLight: '#fee',
      warning: '#f59e0b',
    },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.supabaseFrom(...args),
    storage: {
      from: () => ({
        upload: vi.fn(),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  },
}));

vi.mock('@/lib/upload/uploadBlogImage', () => ({
  uploadBlogImage: vi.fn(),
}));

type AlertButton = { text: string; onPress?: () => Promise<void> };

export const blogPostTestSupport = {
  getDeleteConfirmButton(): AlertButton | undefined {
    const alertButtons = mocks.alert.mock.calls[0][2] as AlertButton[];
    return alertButtons.find((button) => button.text === 'Delete');
  },
  getMocks() {
    return mocks;
  },
  reset() {
    vi.clearAllMocks();
  },
  setupSupabaseMocks(deleteResult: { error: unknown }) {
    const eqMerchant = vi.fn().mockResolvedValue(deleteResult);
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    mocks.deleteFn.mockReturnValue({ eq: eqId });

    const updateEqMerchant = vi.fn().mockResolvedValue({ error: null });
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqMerchant });
    mocks.updateFn.mockReturnValue({ eq: updateEqId });

    const selectSingle = vi.fn().mockResolvedValue({
      data: {
        title: 'Test Post',
        excerpt: 'Excerpt',
        category: 'Tech',
        featured_image_url: '',
        published_at: null,
        status: 'draft',
      },
      error: null,
    });

    const selectEqMerchant = vi.fn().mockReturnValue({ single: selectSingle });
    const selectEqId = vi.fn().mockReturnValue({ eq: selectEqMerchant });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEqId });

    mocks.supabaseFrom.mockReturnValue({
      select: selectMock,
      delete: mocks.deleteFn,
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: mocks.updateFn,
    });

    return { eqId, eqMerchant, updateEqId, updateEqMerchant };
  },
};
