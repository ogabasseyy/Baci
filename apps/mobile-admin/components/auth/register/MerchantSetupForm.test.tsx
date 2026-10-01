import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '@/lib/api-errors';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  authUserReady: true,
  authUser: {
    id: 'user-1',
    email: 'ada@example.com',
    user_metadata: {
      first_name: 'Ada',
      last_name: 'Lovelace',
      avatar_url: 'https://cdn.usebaci.com/ada.png',
    },
  } as {
    id: string;
    email?: string;
    user_metadata: Record<string, unknown>;
  },
  mutateAsync: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Alert: { alert: mocks.alert },
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, onClick: onPress },
        children
      ),
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      accessibilityLabel,
      onChangeText,
      value,
    }: {
      accessibilityLabel?: string;
      onChangeText?: (value: string) => void;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        value,
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('expo-linear-gradient', async () => {
  const ReactRuntime = await import('react');
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      ReactRuntime.createElement('div', null, children),
  };
});
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('@/components/ui/CountryPickerModal', () => ({
  CountryPickerModal: () => null,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#ddd',
      inputBg: '#fff',
      primary: '#111',
      text: '#111',
      textMuted: '#666',
      textOnPrimary: '#fff',
      textSecondary: '#555',
    },
  }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mocks.authUserReady ? mocks.authUser : null,
    signOut: mocks.signOut,
  }),
}));
vi.mock('@/hooks/useMerchantProvisioning', () => ({
  useMerchantProvisioning: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));
vi.mock('./PersonNameFields', async () => {
  return {
    PersonNameFields: ({
      firstName,
      lastName,
      onFirstNameChange,
      onLastNameChange,
    }: {
      firstName: string;
      lastName: string;
      onFirstNameChange: (value: string) => void;
      onLastNameChange: (value: string) => void;
    }) => (
      <>
        <input
          aria-label="First Name"
          onChange={(event) => onFirstNameChange(event.target.value)}
          value={firstName}
        />
        <input
          aria-label="Last Name"
          onChange={(event) => onLastNameChange(event.target.value)}
          value={lastName}
        />
      </>
    ),
  };
});
vi.mock('./RegisterBusinessStep', () => ({
  RegisterBusinessStep: ({
    formData,
    onBusinessNameChange,
    onBusinessTypeChange,
    onLaunchStore,
    onSlugChange,
    slugError,
  }: {
    formData: { businessName: string; slug: string };
    onBusinessNameChange: (value: string) => void;
    onBusinessTypeChange: (value: string) => void;
    onLaunchStore: () => void;
    onSlugChange: (value: string) => void;
    slugError?: string | null;
  }) => (
    <>
      <input
        aria-label="Business Name"
        onChange={(event) => onBusinessNameChange(event.target.value)}
        value={formData.businessName}
      />
      <input
        aria-label="Store Link"
        onChange={(event) => onSlugChange(event.target.value)}
        value={formData.slug}
      />
      <button onClick={() => onBusinessTypeChange('fashion')} type="button">
        Fashion
      </button>
      <button onClick={onLaunchStore} type="button">
        Launch Store
      </button>
      {slugError ? <span>{slugError}</span> : null}
    </>
  ),
}));

import { MerchantSetupForm } from './MerchantSetupForm';

function fillBusinessForm() {
  const continueButton = screen.queryByRole('button', {
    name: 'Continue to business info',
  });
  if (continueButton) {
    fireEvent.click(continueButton);
  }
  fireEvent.change(screen.getByLabelText('Business Name'), {
    target: { value: 'Analytical Engines' },
  });
  fireEvent.click(screen.getByText('Fashion'));
}

describe('MerchantSetupForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUserReady = true;
    mocks.authUser.id = 'user-1';
    mocks.authUser.email = 'ada@example.com';
    mocks.authUser.user_metadata = {
      first_name: 'Ada',
      last_name: 'Lovelace',
      avatar_url: 'https://cdn.usebaci.com/ada.png',
    };
    mocks.mutateAsync.mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-1', slug: 'analytical-engines' },
      created: true,
    });
  });
  it('prefills identity metadata and submits only authenticated store data', async () => {
    render(<MerchantSetupForm />);
    fillBusinessForm();
    fireEvent.click(screen.getByText('Launch Store'));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());
    const payload = mocks.mutateAsync.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      businessName: 'Analytical Engines',
      businessType: 'fashion',
      country: 'NG',
      logoUrl: 'https://cdn.usebaci.com/ada.png',
      brandColors: expect.any(Object),
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain('password');
    expect(mocks.replace).toHaveBeenCalledWith('/(admin)/(tabs)');
  });
  it('waits for provisioning and cache refetch before dashboard replacement', async () => {
    const provisioning = Promise.withResolvers<{
      success: true;
      merchant: { id: string; slug: string };
      created: true;
    }>();
    mocks.mutateAsync.mockReturnValue(provisioning.promise);
    render(<MerchantSetupForm />);
    fillBusinessForm();
    fireEvent.click(screen.getByText('Launch Store'));
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => {
      provisioning.resolve({
        success: true,
        merchant: { id: 'merchant-1', slug: 'analytical-engines' },
        created: true,
      });
      await provisioning.promise;
    });
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/(admin)/(tabs)')
    );
  });
  it('keeps slug conflicts on the form and identifies Store Link', async () => {
    mocks.mutateAsync.mockRejectedValue(
      new NetworkError('That store URL is unavailable.', {
        statusCode: 409,
        data: { code: 'slug_unavailable' },
      })
    );
    render(<MerchantSetupForm />);
    fillBusinessForm();
    fireEvent.click(screen.getByText('Launch Store'));
    await waitFor(() =>
      expect(screen.getByText('That store URL is unavailable.')).toBeTruthy()
    );
    expect(mocks.alert).toHaveBeenCalledWith(
      'Store Link Unavailable',
      'That store URL is unavailable.'
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it('bugfix: keeps country selection after email signup without re-asking for name', () => {
    render(<MerchantSetupForm />);

    expect(screen.queryByLabelText('First Name')).toBeNull();
    expect(screen.queryByLabelText('Last Name')).toBeNull();
    expect(screen.getByText('Your location')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Country / Region, Nigeria' })
    ).toBeTruthy();
    expect(screen.queryByLabelText('Business Name')).toBeNull();
  });

  it('requires missing social-auth names to be completed', async () => {
    mocks.authUser.user_metadata = {};
    render(<MerchantSetupForm />);
    expect(screen.getByText('Owner Details')).toBeTruthy();
    expect(screen.getByLabelText('First Name')).toBeTruthy();
    expect(screen.getByLabelText('Last Name')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to business info' })
    );
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Check Your Details',
      'Please enter your first and last name.'
    );
  });
  it('offers reauthentication instead of accepting a body email override', async () => {
    delete mocks.authUser.email;
    render(<MerchantSetupForm />);
    fillBusinessForm();
    fireEvent.click(screen.getByText('Launch Store'));

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Sign In Again',
      expect.stringMatching(/missing required identity/i),
      expect.any(Array)
    );
  });
});
