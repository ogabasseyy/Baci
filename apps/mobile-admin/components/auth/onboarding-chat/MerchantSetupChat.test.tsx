import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signOut: vi.fn(async () => undefined),
  provisionMutateAsync: vi.fn(),
  assistMutateAsync: vi.fn(),
  persistProvisionedStoreLogo: vi.fn(async () => true),
  user: {
    id: 'user-1',
    email: 'ada@example.com',
    user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
  } as null | {
    id: string;
    email: string;
    user_metadata: Record<string, unknown>;
  },
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    ActivityIndicator: () => React.createElement('span', null, 'spinner'),
    Alert: { alert: vi.fn() },
    FlatList: ({
      data,
      renderItem,
    }: {
      data: Array<{ id: string }>;
      renderItem: (info: { item: { id: string } }) => React.ReactNode;
    }) =>
      React.createElement(
        'div',
        null,
        data.map((item) =>
          React.createElement(
            React.Fragment,
            { key: item.id },
            renderItem({ item })
          )
        )
      ),
    Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) =>
      React.createElement('img', { alt: accessibilityLabel }),
    Pressable: ({
      accessibilityLabel,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          disabled,
          onClick: onPress,
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      accessibilityLabel,
      onChangeText,
      placeholder,
      value,
    }: {
      accessibilityLabel?: string;
      onChangeText?: (text: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value,
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('expo-image', async () => {
  const React = await import('react');
  return {
    Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) =>
      React.createElement('img', { alt: accessibilityLabel }),
  };
});
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/components/ui/AppKeyboardContainer', async () => {
  const React = await import('react');
  return {
    AppKeyboardContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});
vi.mock('@/components/ui/CountryPickerModal', () => ({
  CountryPickerModal: () => null,
}));
vi.mock('@/components/ui/virtualized-list-props', () => ({
  getVirtualizedListProps: () => ({}),
}));
vi.mock('./onboarding-chat.logo-upload', () => ({
  persistProvisionedStoreLogo: mocks.persistProvisionedStoreLogo,
  pickOnboardingLogo: vi.fn(async () => ({
    uri: 'file:///tmp/uploaded-logo.png',
    fileName: 'uploaded-logo.png',
    mimeType: 'image/png',
  })),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mocks.user,
    signOut: mocks.signOut,
  }),
}));
vi.mock('@/hooks/useMerchantProvisioning', () => ({
  useMerchantProvisioning: () => ({
    isPending: false,
    mutateAsync: mocks.provisionMutateAsync,
  }),
}));
vi.mock('@/hooks/useOnboardingAssist', () => ({
  useOnboardingAssist: () => ({
    isPending: false,
    mutateAsync: mocks.assistMutateAsync,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#e5e7eb',
      card: '#f9fafb',
      error: '#dc2626',
      errorLight: '#fee2e2',
      primary: '#111827',
      primaryLight: '#eef2ff',
      text: '#111827',
      textMuted: '#9ca3af',
      textOnPrimary: '#ffffff',
      textSecondary: '#4b5563',
    },
  }),
}));

import { NetworkError } from '@/lib/api-errors';
import { MerchantSetupChat } from './MerchantSetupChat';

describe('MerchantSetupChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = {
      id: 'user-1',
      email: 'ada@example.com',
      user_metadata: { first_name: 'Ada', last_name: 'Okafor' },
    };
    mocks.provisionMutateAsync.mockResolvedValue({
      success: true,
      merchant: { id: 'm-1', slug: 'kicks-hub' },
      created: true,
    });
  });

  it('walks through the chat flow and launches the store with collected details', async () => {
    render(<MerchantSetupChat />);

    expect(
      screen.getByText(/Welcome to Baci, Ada!.*Where is your business based\?/)
    ).toBeTruthy();

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByText('Skip for now'));
    fireEvent.click(screen.getByText('Fashion & Apparel'));

    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith({
        firstName: 'Ada',
        lastName: 'Okafor',
        phone: undefined,
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        otherBusinessType: undefined,
        country: 'NG',
        slug: 'kicks-hub',
        slugIsCustom: false,
        logoUrl: undefined,
        brandColors: {
          primary: '#000000',
          background: '#ffffff',
          accent: '#f59e0b',
        },
      });
    });
    expect(mocks.replace).toHaveBeenCalledWith('/(admin)/(tabs)');
  });

  it('supports AI business name suggestions and AI logo generation inside chat', async () => {
    mocks.assistMutateAsync
      .mockResolvedValueOnce({
        businessNames: ['Lagos Lace', 'Sole Craft'],
      })
      .mockResolvedValueOnce({
        logos: ['data:image/png;base64,iVBORw0KGgo='],
        brandColors: {
          primary: '#1E293B',
          background: '#FFFFFF',
          accent: '#F59E0B',
        },
      });

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByText('Skip for now'));
    fireEvent.click(screen.getByText('Fashion & Apparel'));

    fireEvent.click(screen.getByText('Suggest names for me'));
    fireEvent.change(
      screen.getByLabelText('Business description for name ideas'),
      {
        target: { value: 'Handmade sneakers in Lagos' },
      }
    );
    fireEvent.click(screen.getByLabelText('Send response'));

    await waitFor(() => {
      expect(screen.getByText('Lagos Lace')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Lagos Lace'));

    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "I don't have one" }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate a logo' }));
    await waitFor(() => {
      expect(screen.getByAltText('Generated store logo preview')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: 'Lagos Lace',
          slug: 'lagos-lace',
          logoUrl: undefined,
          brandColors: {
            primary: '#1E293B',
            background: '#FFFFFF',
            accent: '#F59E0B',
          },
        })
      );
      expect(mocks.persistProvisionedStoreLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: 'm-1',
          logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
        })
      );
    });
  });

  it('asks for owner name first when user metadata has no name', () => {
    mocks.user = {
      id: 'user-2',
      email: 'new@example.com',
      user_metadata: {},
    };

    render(<MerchantSetupChat />);

    expect(screen.getByText(/First, what's your full name\?/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Full name input'), {
      target: { value: 'Tunde Bello' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    expect(
      screen.getByText(
        /Nice to meet you, Tunde! Where is your business based\?/
      )
    ).toBeTruthy();
  });

  it('hides the Use suggested link chip after a slug_unavailable provisioning error', async () => {
    mocks.provisionMutateAsync.mockRejectedValueOnce(
      new NetworkError(
        'That store URL is unavailable. Please choose another.',
        {
          statusCode: 409,
          data: { code: 'slug_unavailable' },
        }
      )
    );

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(screen.getByText(/Type another store link below:/)).toBeTruthy();
    });
    expect(
      screen.queryByRole('button', { name: 'Use suggested link' })
    ).toBeNull();
  });

  it('does not pre-seed OAuth avatar_url as the store logo when the user skips logo setup', async () => {
    mocks.user = {
      id: 'user-3',
      email: 'oauth@example.com',
      user_metadata: {
        first_name: 'Ada',
        last_name: 'Okafor',
        avatar_url: 'https://lh3.googleusercontent.com/personal-avatar.jpg',
      },
    };

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: 'Kicks Hub',
          logoUrl: undefined,
        })
      );
    });
  });

  it('returns straight to summary after Change phone without losing custom slug or accepted logo', async () => {
    mocks.assistMutateAsync.mockResolvedValueOnce({
      logos: ['data:image/png;base64,iVBORw0KGgo='],
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: "I don't have one" }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate a logo' }));
    await waitFor(() => {
      expect(screen.getByAltText('Generated store logo preview')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this logo' }));

    fireEvent.click(screen.getByRole('button', { name: 'Customize link' }));
    fireEvent.change(screen.getByLabelText('Custom store link input'), {
      target: { value: 'custom-kicks' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: 'Change phone' }));
    fireEvent.change(screen.getByLabelText('Phone number input'), {
      target: { value: '+234 801 234 5678' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+234 801 234 5678',
          slug: 'custom-kicks',
          slugIsCustom: true,
          brandColors: {
            primary: '#1E293B',
            background: '#FFFFFF',
            accent: '#F59E0B',
          },
        })
      );
      expect(mocks.persistProvisionedStoreLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
        })
      );
    });
  });

  it('clears generated logo draft and colors if user skips after generating', async () => {
    mocks.assistMutateAsync.mockResolvedValueOnce({
      logos: ['data:image/png;base64,iVBORw0KGgo='],
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: "I don't have one" }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate a logo' }));
    await waitFor(() => {
      expect(screen.getByAltText('Generated store logo preview')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skip logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          logoUrl: undefined,
          brandColors: {
            primary: '#000000',
            background: '#ffffff',
            accent: '#f59e0b',
          },
        })
      );
      expect(mocks.persistProvisionedStoreLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          logoUrl: '',
          pickedAsset: null,
        })
      );
    });
  });

  it('preserves an uploaded logo pickedAsset after Change store name from the summary', async () => {
    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: 'Upload logo' }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Use this logo' })
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));

    fireEvent.click(screen.getByRole('button', { name: 'Change store name' }));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Lagos Kicks' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: 'Lagos Kicks',
          slug: 'lagos-kicks',
        })
      );
      expect(mocks.persistProvisionedStoreLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          logoUrl: 'file:///tmp/uploaded-logo.png',
          pickedAsset: {
            uri: 'file:///tmp/uploaded-logo.png',
            fileName: 'uploaded-logo.png',
            mimeType: 'image/png',
          },
        })
      );
    });
  });

  it('clears rejectedSlug on Start over so the suggested link chip is not suppressed', async () => {
    mocks.provisionMutateAsync.mockRejectedValueOnce(
      new NetworkError(
        'That store URL is unavailable. Please choose another.',
        {
          statusCode: 409,
          data: { code: 'slug_unavailable' },
        }
      )
    );

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(screen.getByText(/Type another store link below:/)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Custom store link input'), {
      target: { value: 'kicks-hub-2' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Customize link' }));

    expect(
      screen.getByRole('button', { name: 'Use suggested link' })
    ).toBeTruthy();
  });

  it('handles an empty/SVG fallback logo response gracefully without triggering a save failure on launch', async () => {
    mocks.assistMutateAsync.mockResolvedValueOnce({
      logos: [],
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    render(<MerchantSetupChat />);

    fireEvent.click(screen.getByText(/Nigeria/));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByText('Fashion & Apparel'));
    fireEvent.change(screen.getByLabelText('Store name input'), {
      target: { value: 'Kicks Hub' },
    });
    fireEvent.click(screen.getByLabelText('Send response'));

    fireEvent.click(screen.getByRole('button', { name: "I don't have one" }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate a logo' }));
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't generate a logo right now/i)
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Looks good!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch my store' }));

    await waitFor(() => {
      expect(mocks.provisionMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: 'Kicks Hub',
          logoUrl: undefined,
        })
      );
      expect(mocks.persistProvisionedStoreLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          logoUrl: '',
        })
      );
    });
  });
});
