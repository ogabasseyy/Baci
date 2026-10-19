import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DateOfBirthPrompt } from './DateOfBirthPrompt';

const mockSetDateOfBirth =
  jest.fn<
    (
      dateOfBirth: string
    ) => Promise<{ success: boolean; error?: string; dateOfBirth?: string }>
  >();

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { setDateOfBirth: typeof mockSetDateOfBirth }) => unknown
  ) => selector({ setDateOfBirth: mockSetDateOfBirth }),
}));

// The native date picker fires a fixed, valid past date (1990-05-23) when the
// field is opened and tapped.
type MockDateTimePickerProps = {
  onChange: (event: { type: 'set' }, date: Date) => void;
};

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: ({ onChange }: MockDateTimePickerProps) => {
    const { Pressable, Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <Pressable
        accessibilityLabel="mock-date-picker"
        accessibilityRole="button"
        onPress={() => onChange({ type: 'set' }, new Date(1990, 4, 23))}
      >
        <Text>mock picker</Text>
      </Pressable>
    );
  },
}));

function pickDate() {
  // Open the field, then tap the (mocked) native picker to select 1990-05-23.
  fireEvent.press(screen.getByRole('button', { name: 'Date of birth' }));
  fireEvent.press(screen.getByRole('button', { name: 'mock-date-picker' }));
  // The iOS spinner is presented as a modal so the parent form remains
  // reachable only after the user confirms the selected value.
  fireEvent.press(
    screen.getByRole('button', { name: 'Done selecting Date of birth' })
  );
}

describe('DateOfBirthPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the date field and keeps submit disabled while empty', () => {
    render(<DateOfBirthPrompt />);

    expect(screen.getByText('Select your date of birth')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save date of birth' })
    ).toHaveAccessibilityState({ disabled: true });
    expect(mockSetDateOfBirth).not.toHaveBeenCalled();
  });

  it('enables submit once a valid date is picked', () => {
    render(<DateOfBirthPrompt />);

    pickDate();

    expect(screen.getByText('1990-05-23')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save date of birth' })
    ).toHaveAccessibilityState({ disabled: false });
  });

  it('submits the picked date via the RPC and calls onSuccess', async () => {
    mockSetDateOfBirth.mockResolvedValue({
      success: true,
      dateOfBirth: '1990-05-23',
    });
    const onSuccess = jest.fn();
    render(<DateOfBirthPrompt onSuccess={onSuccess} submitLabel="Continue" />);

    pickDate();
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByRole('button', { name: 'Continue' })
    ).toBeTruthy();
    expect(mockSetDateOfBirth).toHaveBeenCalledWith('1990-05-23');
    await Promise.resolve();
    expect(onSuccess).toHaveBeenCalledWith('1990-05-23');
  });

  it('renders the returned friendly error when the RPC rejects the date', async () => {
    mockSetDateOfBirth.mockResolvedValue({
      success: false,
      error: 'Enter a valid date of birth.',
    });
    render(<DateOfBirthPrompt />);

    pickDate();
    fireEvent.press(screen.getByRole('button', { name: 'Save date of birth' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid date of birth.'
    );
  });

  it('renders a fallback error when the RPC call throws', async () => {
    mockSetDateOfBirth.mockRejectedValue(new Error('network error'));
    render(<DateOfBirthPrompt />);

    pickDate();
    fireEvent.press(screen.getByRole('button', { name: 'Save date of birth' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.'
    );
  });

  it('prefills from initialValue and honors a custom submitLabel', () => {
    render(
      <DateOfBirthPrompt initialValue="1990-06-15" submitLabel="Continue" />
    );

    expect(screen.getByText('1990-06-15')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});
