import { fireEvent, render, screen } from '@testing-library/react-native';
import { type FieldErrors, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, Text } from 'react-native';
import { BRAND } from '@/constants/Colors';
import type { ShippingAddressInput } from '@/lib/validation';
import { CheckoutFormField } from './CheckoutFormField';

const mockColors = {
  background: '#ffffff',
  border: '#d1d5db',
  error: '#dc2626',
  muted: '#f3f4f6',
  placeholder: '#9ca3af',
  text: '#111827',
  textSecondary: '#6b7280',
};

function CheckoutFormFieldHarness({
  defaultEmail = '',
  errors = {},
  label = 'Email',
  multiline = false,
  transformText,
}: {
  defaultEmail?: string;
  errors?: FieldErrors<ShippingAddressInput>;
  label?: string;
  multiline?: boolean;
  transformText?: (value: string, previous: string) => string;
}) {
  const form = useForm<ShippingAddressInput>({
    defaultValues: {
      address: '',
      city: '',
      email: defaultEmail,
      firstName: '',
      lastName: '',
      notes: '',
      phone: '',
      state: '',
    },
  });

  const email = useWatch({ control: form.control, name: 'email' });
  return (
    <>
      <Text testID="form-email">{email}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset email"
        onPress={() => form.setValue('email', 'reset@example.com')}
      >
        <Text>Reset</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restore email"
        onPress={() => form.setValue('email', 'customer@example.com')}
      >
        <Text>Restore</Text>
      </Pressable>
      <CheckoutFormField
        colors={mockColors}
        control={form.control}
        errors={errors}
        isDark={false}
        keyboardType="email-address"
        label={label}
        multiline={multiline}
        name="email"
        placeholder="you@example.com"
        returnKeyType="done"
        transformText={transformText}
      />
    </>
  );
}

function getInputStyle() {
  return StyleSheet.flatten(
    screen.getByPlaceholderText('you@example.com').props.style
  );
}

describe('CheckoutFormField', () => {
  it('renders label, input hints, and native metadata for the selected field', () => {
    render(<CheckoutFormFieldHarness />);

    const input = screen.getByPlaceholderText('you@example.com');

    expect(screen.getByText('Email')).toBeTruthy();
    expect(input.props.accessibilityHint).toBe('Enter your Email');
    expect(input.props.textContentType).toBe('emailAddress');
    expect(input.props.autoComplete).toBe('email');
    expect(input.props.keyboardType).toBe('email-address');
    expect(input.props.returnKeyType).toBe('done');
  });

  it('falls back to the humanized field name for external visual labels', () => {
    render(<CheckoutFormFieldHarness label="" />);

    const input = screen.getByPlaceholderText('you@example.com');

    expect(input.props.accessibilityLabel).toBe('email address');
    expect(input.props.accessibilityHint).toBe('Enter your email address');
  });

  it('normalizes the form without rewriting autofilled native text until blur', () => {
    render(
      <CheckoutFormFieldHarness transformText={(value) => value.trim()} />
    );

    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.changeText(input, ' customer@example.com ');

    expect(screen.getByTestId('form-email')).toHaveTextContent(
      'customer@example.com'
    );
    expect(input.props.value).toBe(' customer@example.com ');
    fireEvent(input, 'blur');
    expect(input.props.value).toBe('customer@example.com');
  });

  it('processes edits even when transformText returns the current value', () => {
    const transformText = jest.fn((value: string) => value.toLowerCase());
    render(
      <CheckoutFormFieldHarness
        defaultEmail="test@example.com"
        transformText={transformText}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('you@example.com'),
      'TEST@EXAMPLE.COM'
    );

    expect(transformText).toHaveBeenCalledWith(
      'TEST@EXAMPLE.COM',
      'test@example.com'
    );
    expect(screen.getByTestId('form-email')).toHaveTextContent(
      'test@example.com'
    );
    expect(screen.getByPlaceholderText('you@example.com').props.value).toBe(
      'TEST@EXAMPLE.COM'
    );
    fireEvent(screen.getByPlaceholderText('you@example.com'), 'blur');
    expect(screen.getByDisplayValue('test@example.com')).toBeTruthy();
  });

  it('accepts external resets without bringing back a stale autofill draft', () => {
    render(
      <CheckoutFormFieldHarness transformText={(value) => value.trim()} />
    );
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.changeText(input, ' customer@example.com ');
    expect(input.props.value).toBe(' customer@example.com ');
    fireEvent.press(screen.getByRole('button', { name: 'Reset email' }));
    expect(input.props.value).toBe('reset@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Restore email' }));
    expect(input.props.value).toBe('customer@example.com');
  });

  it('keeps deletion responsive when normalization yields an empty value', () => {
    render(
      <CheckoutFormFieldHarness
        defaultEmail="customer@example.com"
        transformText={(value) => value.trim()}
      />
    );
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.changeText(input, ' ');
    expect(input.props.value).toBe(' ');
    expect(screen.getByTestId('form-email').props.children).toBe('');
    fireEvent.changeText(input, '');
    expect(input.props.value).toBe('');
  });

  it('renders validation errors with polite live-region semantics', () => {
    render(
      <CheckoutFormFieldHarness
        errors={{
          email: { message: 'Email is required', type: 'required' },
        }}
      />
    );

    const error = screen.getByText('Email is required');

    expect(error.props.accessibilityLiveRegion).toBe('polite');
    expect(StyleSheet.flatten(error.props.style).color).toBe(mockColors.error);
  });

  it('updates input border color on focus and blur', () => {
    render(<CheckoutFormFieldHarness />);

    expect(getInputStyle().borderColor).toBe(mockColors.border);

    fireEvent(screen.getByPlaceholderText('you@example.com'), 'focus');
    expect(getInputStyle().borderColor).toBe(BRAND.primary);

    fireEvent(screen.getByPlaceholderText('you@example.com'), 'blur');
    expect(getInputStyle().borderColor).toBe(mockColors.border);
  });

  it('forwards multiline props and styling', () => {
    render(<CheckoutFormFieldHarness multiline />);

    const input = screen.getByPlaceholderText('you@example.com');
    const inputStyle = StyleSheet.flatten(input.props.style);

    expect(input.props.multiline).toBe(true);
    expect(input.props.numberOfLines).toBe(2);
    expect(input.props.returnKeyType).toBe('default');
    expect(inputStyle.minHeight).toBe(80);
    expect(inputStyle.textAlignVertical).toBe('top');
  });
});
