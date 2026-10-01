import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RegisterAccountStep } from '@/components/auth/register/RegisterAccountStep';
import type { PasswordValidationResult } from '@/lib/password-utils';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
}));

vi.mock('expo-linear-gradient', async () => {
  const React = await import('react');
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

// Surface the iOS AutoFill props as data-* attributes so they can be asserted
// from the DOM. Everything else mirrors the react-native mock used by the other
// colocated auth tests.
vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    useColorScheme: vi.fn(() => 'dark'),
    StyleSheet: {
      create: (s: Record<string, unknown>) => s,
    },
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
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
        { onClick: onPress, 'aria-label': accessibilityLabel, disabled },
        children
      ),
    TextInput: ({
      accessibilityLabel,
      autoComplete,
      passwordRules,
      secureTextEntry,
      textContentType,
      value,
      onChangeText,
    }: {
      accessibilityLabel?: string;
      autoComplete?: string;
      passwordRules?: string;
      secureTextEntry?: boolean;
      textContentType?: string;
      value?: string;
      onChangeText?: (value: string) => void;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        'data-autocomplete': autoComplete ?? '',
        'data-password-rules': passwordRules ?? '',
        'data-text-content-type': textContentType ?? '',
        readOnly: true,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        type: secureTextEntry ? 'password' : 'text',
        value: value ?? '',
      }),
  };
});

const passwordState: PasswordValidationResult = {
  isValid: false,
  strength: 0,
  requirements: {
    length: false,
    complexity: false,
    notCommon: false,
    match: true,
  },
};

function renderStep(
  updateForm = vi.fn(),
  formDataOverrides: Partial<{
    confirmPassword: string;
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  }> = {}
) {
  return render(
    <RegisterAccountStep
      confirmError={null}
      formData={{
        confirmPassword: '',
        email: '',
        firstName: '',
        lastName: '',
        password: '',
        ...formDataOverrides,
      }}
      onNext={vi.fn()}
      onTogglePassword={vi.fn()}
      passwordState={passwordState}
      showPassword={false}
      updateForm={updateForm}
    />
  );
}

describe('RegisterAccountStep iOS AutoFill contract', () => {
  it('declares newPassword on both password fields so iOS does not guess', () => {
    // Arrange
    renderStep();

    // Act
    const password = screen.getByLabelText('Password');
    const confirmPassword = screen.getByLabelText('Confirm Password');

    // Assert
    expect(password.getAttribute('data-text-content-type')).toBe('newPassword');
    expect(password.getAttribute('data-autocomplete')).toBe('password-new');
    expect(confirmPassword.getAttribute('data-text-content-type')).toBe(
      'newPassword'
    );
    expect(confirmPassword.getAttribute('data-autocomplete')).toBe(
      'password-new'
    );
  });

  it('requests a generated password long enough to clear the complexity rule', () => {
    // Arrange
    renderStep();

    // Act
    const password = screen.getByLabelText('Password');

    const confirmPassword = screen.getByLabelText('Confirm Password');

    // Assert — validatePassword only marks "complexity" at 10+ characters, so a
    // shorter suggestion would land the user on a failing checklist. Both
    // fields must agree or iOS can generate a value the confirm field rejects.
    expect(password.getAttribute('data-password-rules')).toBe('minlength: 10;');
    expect(confirmPassword.getAttribute('data-password-rules')).toBe(
      'minlength: 10;'
    );
  });

  it('declares identity content types on the name and email fields', () => {
    // Arrange
    renderStep();

    // Act
    const firstName = screen.getByLabelText('First Name');
    const lastName = screen.getByLabelText('Last Name');
    const email = screen.getByLabelText('Email Address');

    // Assert
    expect(firstName.getAttribute('data-text-content-type')).toBe('givenName');
    expect(firstName.getAttribute('data-autocomplete')).toBe('given-name');
    expect(lastName.getAttribute('data-text-content-type')).toBe('familyName');
    expect(lastName.getAttribute('data-autocomplete')).toBe('family-name');
    expect(email.getAttribute('data-text-content-type')).toBe('emailAddress');
    expect(email.getAttribute('data-autocomplete')).toBe('email');
  });
});

describe('RegisterAccountStep pending state', () => {
  it('disables the next-step action while account creation is pending', () => {
    render(
      <RegisterAccountStep
        confirmError={null}
        formData={{
          confirmPassword: 'StrongP@ss123!',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          password: 'StrongP@ss123!',
        }}
        isLoading={true}
        onNext={vi.fn()}
        onTogglePassword={vi.fn()}
        passwordState={passwordState}
        showPassword={false}
        updateForm={vi.fn()}
      />
    );

    expect(
      (
        screen.getByRole('button', {
          name: 'Creating account...',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});

describe('RegisterAccountStep name normalization', () => {
  it('forces typed or pasted first and last names to sentence case', () => {
    const updateForm = vi.fn();
    renderStep(updateForm);

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: 'aDA' },
    });
    fireEvent.change(screen.getByLabelText('Last Name'), {
      target: { value: 'lOVELACE' },
    });

    expect(updateForm).toHaveBeenNthCalledWith(1, 'firstName', 'Ada');
    expect(updateForm).toHaveBeenNthCalledWith(2, 'lastName', 'Lovelace');
  });

  it('preserves empty and whitespace-only name input without throwing', () => {
    const updateForm = vi.fn();
    renderStep(updateForm, { firstName: 'Ada', lastName: 'Lovelace' });

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Last Name'), {
      target: { value: '   ' },
    });

    expect(updateForm).toHaveBeenNthCalledWith(1, 'firstName', '');
    expect(updateForm).toHaveBeenNthCalledWith(2, 'lastName', '   ');
  });
});
