import { fireEvent, render, screen } from '@testing-library/react-native';
import { type FieldErrors, useForm, useWatch } from 'react-hook-form';
import { Text as MockText, TextInput as MockTextInput } from 'react-native';
import type { ShippingAddressInput } from '@/lib/validation';
import { CheckoutContactCard } from './CheckoutContactCard';

jest.mock('@/components/ui/PhoneInput', () => ({
  PhoneInput: (props: {
    error?: string;
    onBlur?: () => void;
    onChangeText?: (value: string) => void;
    value?: string;
  }) => {
    return (
      <>
        <MockTextInput
          accessibilityLabel="Phone number"
          onBlur={props.onBlur}
          onChangeText={props.onChangeText}
          placeholder="Phone number"
          value={props.value}
        />
        {props.error ? <MockText>{props.error}</MockText> : null}
      </>
    );
  },
}));

const mockColors = {
  background: '#ffffff',
  border: '#d1d5db',
  card: '#ffffff',
  error: '#dc2626',
  muted: '#f3f4f6',
  placeholder: '#9ca3af',
  text: '#111827',
  textSecondary: '#6b7280',
};

const defaultAddress: ShippingAddressInput = {
  address: '',
  city: '',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  notes: '',
  phone: '+2348012345678',
  state: '',
};

function CheckoutContactCardHarness({
  accountPassword = '',
  contactSummary = 'Jane Doe',
  errors = {},
  hasContactIdentity = false,
  isAuthenticated = false,
  isCollapsed = false,
  onChangeAccountPassword = jest.fn(),
  onContactEmailSettled = jest.fn(),
  onToggleCollapsed = jest.fn(),
  onToggleSaveDetails = jest.fn(),
  saveDetails = false,
}: {
  accountPassword?: string;
  contactSummary?: string;
  errors?: FieldErrors<ShippingAddressInput>;
  hasContactIdentity?: boolean;
  isAuthenticated?: boolean;
  isCollapsed?: boolean;
  onChangeAccountPassword?: (value: string) => void;
  onContactEmailSettled?: () => void;
  onToggleCollapsed?: () => void;
  onToggleSaveDetails?: () => void;
  saveDetails?: boolean;
}) {
  const form = useForm<ShippingAddressInput>({
    defaultValues: defaultAddress,
  });
  // useWatch instead of watch(): watch() is incompatible with React Compiler
  // memoization (interior mutability).
  const email = useWatch({ control: form.control, name: 'email' });
  const phone = useWatch({ control: form.control, name: 'phone' });

  return (
    <CheckoutContactCard
      accountPassword={accountPassword}
      colors={mockColors}
      contactSummary={contactSummary}
      control={form.control}
      email={email}
      errors={errors}
      hasContactIdentity={hasContactIdentity}
      isAuthenticated={isAuthenticated}
      isCollapsed={isCollapsed}
      isDark={false}
      onChangeAccountPassword={onChangeAccountPassword}
      onContactEmailSettled={onContactEmailSettled}
      onToggleCollapsed={onToggleCollapsed}
      onToggleSaveDetails={onToggleSaveDetails}
      phone={phone}
      saveDetails={saveDetails}
    />
  );
}

describe('CheckoutContactCard', () => {
  it('renders contact fields and guest save-details control', () => {
    const onToggleSaveDetails = jest.fn();

    render(
      <CheckoutContactCardHarness onToggleSaveDetails={onToggleSaveDetails} />
    );

    expect(screen.getByText('Contact')).toBeTruthy();
    expect(screen.getByPlaceholderText('E.g. John')).toBeTruthy();
    expect(screen.getByPlaceholderText('E.g. Doe')).toBeTruthy();
    expect(screen.getByPlaceholderText('john@example.com')).toBeTruthy();

    fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Save my details for faster checkout',
      })
    );

    expect(onToggleSaveDetails).toHaveBeenCalledTimes(1);
  });

  it('strips whitespace from the email as the user types', () => {
    render(<CheckoutContactCardHarness />);

    const emailInput = screen.getByPlaceholderText('john@example.com');
    fireEvent.changeText(emailInput, ' ja ne@ example.com ');

    expect(emailInput.props.value).toBe('jane@example.com');
  });

  it('settles the current email on blur and keyboard submission', () => {
    const onContactEmailSettled = jest.fn();
    render(
      <CheckoutContactCardHarness
        onContactEmailSettled={onContactEmailSettled}
      />
    );

    const emailInput = screen.getByPlaceholderText('john@example.com');
    fireEvent(emailInput, 'blur');
    fireEvent(emailInput, 'submitEditing');

    expect(onContactEmailSettled).toHaveBeenCalledTimes(2);
  });

  it('shows account creation details and password validation for guests saving details', () => {
    const onChangeAccountPassword = jest.fn();

    render(
      <CheckoutContactCardHarness
        accountPassword="short"
        onChangeAccountPassword={onChangeAccountPassword}
        saveDetails
      />
    );

    expect(screen.getByText(/This will create an account/i)).toBeTruthy();
    expect(
      screen.getByText('Password must be at least 6 characters')
    ).toBeTruthy();

    fireEvent.changeText(
      screen.getByLabelText('Create a password'),
      'long-enough'
    );

    expect(onChangeAccountPassword).toHaveBeenCalledWith('long-enough');
  });

  it('keeps guest contact fields expanded even if parent state is collapsed', () => {
    render(<CheckoutContactCardHarness isCollapsed />);

    expect(screen.getByPlaceholderText('E.g. John')).toBeTruthy();
    expect(screen.queryByText('Signed in')).toBeNull();
    expect(screen.queryByRole('button', { name: /edit contact/i })).toBeNull();
  });

  it('renders the collapsed signed-in summary and edit action', () => {
    const onToggleCollapsed = jest.fn();

    render(
      <CheckoutContactCardHarness
        hasContactIdentity
        isAuthenticated
        isCollapsed
        onToggleCollapsed={onToggleCollapsed}
      />
    );

    expect(screen.getByText('Signed in')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    expect(screen.getByText('+2348012345678')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Edit Contact' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('uses a neutral summary label when a guest contact form is collapsed', () => {
    render(
      <CheckoutContactCardHarness
        hasContactIdentity
        isCollapsed
        onToggleCollapsed={jest.fn()}
      />
    );

    expect(screen.getByText('Contact details')).toBeTruthy();
    expect(screen.queryByText('Signed in')).toBeNull();
  });

  it('shows the done action and hides guest save-details when an authenticated contact is expanded', () => {
    render(<CheckoutContactCardHarness hasContactIdentity isAuthenticated />);

    expect(
      screen.getByRole('button', { name: 'Done editing Contact' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('checkbox', {
        name: 'Save my details for faster checkout',
      })
    ).toBeNull();
  });

  it('hides the collapse action when an authenticated user has no contact identity', () => {
    render(
      <CheckoutContactCardHarness
        hasContactIdentity={false}
        isAuthenticated
        isCollapsed={false}
      />
    );

    expect(
      screen.queryByRole('button', { name: /done editing contact/i })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /edit contact/i })).toBeNull();
  });

  it('passes phone validation errors into the phone input', () => {
    render(
      <CheckoutContactCardHarness
        errors={{
          phone: { message: 'Phone is required', type: 'required' },
        }}
      />
    );

    expect(screen.getByText('Phone is required')).toBeTruthy();
  });
});
