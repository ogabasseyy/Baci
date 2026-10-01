import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RegisterBusinessStep } from './RegisterBusinessStep';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
}));
vi.mock('expo-linear-gradient', async () => {
  const ReactRuntime = await import('react');
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      ReactRuntime.createElement('div', null, children),
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    ActivityIndicator: () => null,
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
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
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/auth/BusinessTypeSelector', () => ({
  BusinessTypeSelector: () => null,
}));

vi.mock('@/components/auth/register/RegisterLegalText', () => ({
  RegisterLegalText: () => null,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#000000',
      card: '#000000',
      inputBg: '#000000',
      primary: '#000000',
      text: '#ffffff',
      textMuted: '#000000',
      textOnPrimary: '#ffffff',
      textSecondary: '#000000',
    },
  }),
}));

function renderStep({
  businessType = '',
  onBack,
  slugError,
}: {
  businessType?: string;
  onBack?: () => void;
  slugError?: string;
} = {}) {
  render(
    <RegisterBusinessStep
      firstName="Ada"
      formData={{
        businessName: '',
        businessType,
        otherBusinessType: '',
        slug: '',
      }}
      isLoading={false}
      onBack={onBack}
      onBusinessNameChange={vi.fn()}
      onBusinessTypeChange={vi.fn()}
      onLaunchStore={vi.fn()}
      onOtherBusinessTypeChange={vi.fn()}
      onSlugChange={vi.fn()}
      slugError={slugError}
    />
  );
}

describe('RegisterBusinessStep conditional business type', () => {
  it('shows Please specify when Other is selected', () => {
    renderStep({ businessType: 'other' });

    expect(screen.getByLabelText('Please specify')).toBeInTheDocument();
  });
});

describe('RegisterBusinessStep business name normalization', () => {
  it('welcomes the owner by first name on the business page', () => {
    renderStep();

    expect(screen.getByText('Welcome, Ada!')).toBeInTheDocument();
    expect(
      screen.getByText('Add your business details to launch your store.')
    ).toBeInTheDocument();
  });

  it('offers a way back to the about-you step', () => {
    const onBack = vi.fn();
    renderStep({ onBack });

    fireEvent.click(screen.getByRole('button', { name: 'Back to about you' }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it('hides the about-you back action when owner details were already collected', () => {
    renderStep();

    expect(
      screen.queryByRole('button', { name: 'Back to about you' })
    ).not.toBeInTheDocument();
  });

  it('capitalizes every word typed or pasted into Business Name', () => {
    const onBusinessNameChange = vi.fn();
    render(
      <RegisterBusinessStep
        firstName="Ada"
        formData={{
          businessName: '',
          businessType: '',
          otherBusinessType: '',
          slug: '',
        }}
        isLoading={false}
        onBack={vi.fn()}
        onBusinessNameChange={onBusinessNameChange}
        onBusinessTypeChange={vi.fn()}
        onLaunchStore={vi.fn()}
        onOtherBusinessTypeChange={vi.fn()}
        onSlugChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Business Name'), {
      target: { value: "o'rEILLY mary-jANE fASHION hOUSE" },
    });

    expect(onBusinessNameChange).toHaveBeenCalledWith(
      "O'Reilly Mary-Jane Fashion House"
    );
  });
});

describe('RegisterBusinessStep store link validation', () => {
  it('shows a specific unavailable-slug error beside the store link', () => {
    renderStep({ slugError: 'That store link is already taken.' });

    expect(
      screen.getByText('That store link is already taken.')
    ).toBeInTheDocument();
  });
});
