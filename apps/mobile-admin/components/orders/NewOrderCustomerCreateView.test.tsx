import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CountryCode } from 'react-native-country-picker-modal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNewCustomerDraft } from '@/components/orders/new-order.defaults';
import type { SelectableCustomer } from '@/components/orders/new-order.types';
import { LIGHT_COLORS } from '@/constants/theme';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { DEFAULT_COUNTRY_CODE } from './new-order.shared';

const keyboardState = vi.hoisted(() => ({
  dismiss: vi.fn(),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

vi.mock('@gorhom/bottom-sheet', async () => {
  const React = await import('react');

  return {
    BottomSheetFlatList: ({
      data,
      keyExtractor,
      renderItem,
    }: {
      data?: unknown[];
      keyExtractor?: (item: unknown, index: number) => string;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    }) =>
      React.createElement(
        'div',
        null,
        data?.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index })
          )
        )
      ),
    BottomSheetTextInput: React.forwardRef(
      (
        {
          accessibilityLabel,
          onChangeText,
          onSubmitEditing,
          placeholder,
          returnKeyType,
          submitBehavior,
          value,
        }: {
          accessibilityLabel?: string;
          onChangeText?: (value: string) => void;
          onSubmitEditing?: () => void;
          placeholder?: string;
          returnKeyType?: string;
          submitBehavior?: string;
          value?: string;
        },
        ref: React.Ref<HTMLInputElement>
      ) =>
        React.createElement('input', {
          'aria-label': accessibilityLabel,
          'data-gorhom-input': 'true',
          'data-return-key-type': returnKeyType,
          'data-submit-behavior': submitBehavior,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            onChangeText?.(event.target.value),
          onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              onSubmitEditing?.();
            }
          },
          placeholder,
          ref,
          value: value ?? '',
        })
    ),
    BottomSheetScrollView: React.forwardRef(
      (
        {
          children,
        }: {
          children?: React.ReactNode;
        },
        ref: React.Ref<{ scrollToEnd: () => void }>
      ) => {
        React.useImperativeHandle(ref, () => ({ scrollToEnd: vi.fn() }));
        return React.createElement('div', null, children);
      }
    ),
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    ActivityIndicator: () =>
      React.createElement('span', { role: 'progressbar' }, 'loading'),
    Alert: { alert: vi.fn() },
    Keyboard: { dismiss: keyboardState.dismiss },
    Pressable: ({
      accessibilityLabel,
      children,
      disabled,
      accessibilityState,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      disabled?: boolean;
      accessibilityState?: {
        busy?: boolean;
        disabled?: boolean;
        expanded?: boolean;
        selected?: boolean;
      };
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-busy': accessibilityState?.busy,
          'aria-expanded': accessibilityState?.expanded,
          'aria-label': accessibilityLabel,
          'aria-selected': accessibilityState?.selected,
          disabled,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: React.forwardRef(
      (
        {
          accessibilityLabel,
          onBlur,
          onChangeText,
          onFocus,
          onSubmitEditing,
          placeholder,
          returnKeyType,
          submitBehavior,
          value,
        }: {
          accessibilityLabel?: string;
          onBlur?: () => void;
          onChangeText?: (value: string) => void;
          onFocus?: () => void;
          onSubmitEditing?: () => void;
          placeholder?: string;
          returnKeyType?: string;
          submitBehavior?: string;
          value?: string;
        },
        ref: React.Ref<HTMLInputElement>
      ) =>
        React.createElement('input', {
          'aria-label': accessibilityLabel,
          'data-return-key-type': returnKeyType,
          'data-submit-behavior': submitBehavior,
          onBlur,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            onChangeText?.(event.target.value),
          onFocus,
          onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              onSubmitEditing?.();
            }
          },
          placeholder,
          ref,
          value: value ?? '',
        })
    ),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    useWindowDimensions: () => ({ height: 900, width: 440 }),
  };
});

import { NewOrderCustomerCreateView } from './NewOrderCustomerCreateView';

type CustomerCreateController = Pick<
  ReturnType<typeof useNewOrderController>,
  | 'colors'
  | 'createCustomerMutation'
  | 'duplicateCustomer'
  | 'handleCreateCustomer'
  | 'handleSelectCustomer'
  | 'newCustomer'
  | 'resetNewCustomerForm'
  | 'selectedCountryCode'
  | 'setDuplicateCustomer'
  | 'setIsCreatingCustomer'
  | 'setNewCustomer'
  | 'setSelectedCountryCode'
>;

function applyStateUpdate<T>(update: React.SetStateAction<T>, previous: T): T {
  return typeof update === 'function'
    ? (update as (value: T) => T)(previous)
    : update;
}

function makeController(overrides: Partial<CustomerCreateController> = {}) {
  const state = {
    duplicateCustomer:
      overrides.duplicateCustomer ?? (null as SelectableCustomer | null),
    newCustomer: overrides.newCustomer ?? createEmptyNewCustomerDraft(),
    selectedCountryCode: overrides.selectedCountryCode ?? DEFAULT_COUNTRY_CODE,
  };

  const controller: CustomerCreateController = {
    colors: { ...LIGHT_COLORS, ...overrides.colors },
    createCustomerMutation: {
      isPending: false,
      ...overrides.createCustomerMutation,
    } as CustomerCreateController['createCustomerMutation'],
    duplicateCustomer: state.duplicateCustomer,
    handleCreateCustomer: overrides.handleCreateCustomer ?? vi.fn(),
    handleSelectCustomer: overrides.handleSelectCustomer ?? vi.fn(),
    newCustomer: state.newCustomer,
    resetNewCustomerForm: overrides.resetNewCustomerForm ?? vi.fn(),
    selectedCountryCode: state.selectedCountryCode,
    setDuplicateCustomer:
      overrides.setDuplicateCustomer ??
      vi.fn((value: React.SetStateAction<SelectableCustomer | null>) => {
        state.duplicateCustomer = applyStateUpdate(
          value,
          state.duplicateCustomer
        );
      }),
    setIsCreatingCustomer: overrides.setIsCreatingCustomer ?? vi.fn(),
    setNewCustomer:
      overrides.setNewCustomer ??
      vi.fn((value: React.SetStateAction<typeof state.newCustomer>) => {
        state.newCustomer = applyStateUpdate(value, state.newCustomer);
      }),
    setSelectedCountryCode:
      overrides.setSelectedCountryCode ??
      vi.fn((value: React.SetStateAction<CountryCode>) => {
        state.selectedCountryCode = applyStateUpdate(
          value,
          state.selectedCountryCode
        );
      }),
  };

  return {
    controller,
    snapshot: (): ReturnType<typeof useNewOrderController> =>
      ({
        ...controller,
        duplicateCustomer: state.duplicateCustomer,
        newCustomer: state.newCustomer,
        selectedCountryCode: state.selectedCountryCode,
      }) as ReturnType<typeof useNewOrderController>,
  };
}

describe('NewOrderCustomerCreateView', () => {
  const originalGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'maps-test-key';
    keyboardState.dismiss.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ predictions: [] }),
        status: 200,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGoogleMapsApiKey === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalGoogleMapsApiKey;
    }
  });

  it('updates the draft fields and keeps the address input controlled', () => {
    const harness = makeController();
    const view = render(
      <NewOrderCustomerCreateView controller={harness.snapshot()} />
    );
    const rerender = () =>
      view.rerender(
        <NewOrderCustomerCreateView controller={harness.snapshot()} />
      );
    (
      [
        ['First Name', 'Ada'],
        ['Last Name', 'Lovelace'],
      ] as const
    ).forEach(([placeholder, value]) => {
      fireEvent.change(screen.getByPlaceholderText(placeholder), {
        target: { value },
      });
      rerender();
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '08012345678' },
    });
    rerender();
    fireEvent.click(
      screen.getByLabelText('Select phone country, currently Nigeria')
    );
    fireEvent.change(screen.getByLabelText('Search phone countries'), {
      target: { value: 'gha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use Ghana +233' }));
    rerender();
    fireEvent.change(screen.getByPlaceholderText('Search Address'), {
      target: { value: '12 Allen' },
    });
    rerender();
    expect(screen.getByPlaceholderText('First Name')).toHaveValue('Ada');
    expect(screen.getByPlaceholderText('Last Name')).toHaveValue('Lovelace');
    expect(screen.getByPlaceholderText('Search Address')).toHaveValue(
      '12 Allen'
    );
    expect(harness.controller.setSelectedCountryCode).toHaveBeenCalledWith(
      'GH'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(harness.controller.handleCreateCustomer).toHaveBeenCalledTimes(1);
  });

  it('clears stale fields when switching customer type', () => {
    const harness = makeController({
      newCustomer: {
        ...createEmptyNewCustomerDraft(),
        companyName: 'Old Company',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    });
    const view = render(
      <NewOrderCustomerCreateView controller={harness.snapshot()} />
    );
    const rerender = () =>
      view.rerender(
        <NewOrderCustomerCreateView controller={harness.snapshot()} />
      );

    fireEvent.click(
      screen.getByRole('button', { name: 'Set customer type to Company' })
    );
    rerender();

    expect(harness.snapshot().newCustomer.firstName).toBe('');
    expect(harness.snapshot().newCustomer.lastName).toBe('');
    expect(harness.snapshot().newCustomer.companyName).toBe('Old Company');
    expect(screen.getByLabelText('Company Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('First Name')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Company Name'), {
      target: { value: 'Acme Ltd' },
    });
    rerender();
    fireEvent.click(
      screen.getByRole('button', { name: 'Set customer type to Person' })
    );
    rerender();

    expect(harness.snapshot().newCustomer.companyName).toBe('');
    expect(screen.getByLabelText('First Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Company Name')).not.toBeInTheDocument();
  });

  it('moves focus through customer fields from the keyboard return key', () => {
    const harness = makeController();
    render(<NewOrderCustomerCreateView controller={harness.snapshot()} />);

    const firstNameInput = screen.getByPlaceholderText('First Name');
    const lastNameInput = screen.getByPlaceholderText('Last Name');
    const phoneInput = screen.getByLabelText('Phone Number');
    const emailInput = screen.getByPlaceholderText('Email Address (Optional)');

    expect(firstNameInput).toHaveAttribute('data-return-key-type', 'next');
    expect(firstNameInput).toHaveAttribute('data-submit-behavior', 'submit');
    fireEvent.keyDown(firstNameInput, { key: 'Enter' });
    expect(lastNameInput).toHaveFocus();

    fireEvent.keyDown(lastNameInput, { key: 'Enter' });
    expect(phoneInput).toHaveFocus();

    fireEvent.keyDown(phoneInput, { key: 'Enter' });
    expect(emailInput).toHaveFocus();

    expect(emailInput).toHaveAttribute('data-return-key-type', 'done');
    expect(emailInput).toHaveAttribute('data-submit-behavior', 'blurAndSubmit');
    fireEvent.keyDown(emailInput, { key: 'Enter' });
    expect(keyboardState.dismiss).toHaveBeenCalledTimes(1);
  });

  it('renders a loading state while the customer mutation is pending', () => {
    const harness = makeController({
      createCustomerMutation: {
        isPending: true,
      } as CustomerCreateController['createCustomerMutation'],
    });

    render(<NewOrderCustomerCreateView controller={harness.snapshot()} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('progressbar').closest('button')).toBeDisabled();
    expect(screen.getByRole('progressbar').closest('button')).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.queryByText('Save Customer')).not.toBeInTheDocument();
  });

  it('keeps the typed delivery address when choosing a duplicate customer', () => {
    const duplicateCustomer: SelectableCustomer = {
      address: null,
      company_name: null,
      customer_type: 'individual',
      email: null,
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      id: 'customer-1',
      last_name: 'Lovelace',
      phone: '08012345678',
    };
    const harness = makeController({
      duplicateCustomer,
      newCustomer: {
        ...createEmptyNewCustomerDraft(),
        address: '10 Hospital Road',
      },
    });
    render(<NewOrderCustomerCreateView controller={harness.snapshot()} />);

    expect(
      screen.getByText('The address you entered will be used for this order.')
    ).toBeInTheDocument();
    const button = screen.getByText('Use This').closest('button');
    if (!button) throw new Error('Missing customer selection button');
    fireEvent.click(button);
    expect(harness.controller.handleSelectCustomer).toHaveBeenCalledWith(
      duplicateCustomer,
      true
    );
  });

  it('explains that a city without a street cannot replace the saved destination', () => {
    const duplicateCustomer: SelectableCustomer = {
      address: '12 Allen Avenue',
      company_name: null,
      customer_type: 'individual',
      email: null,
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      id: 'customer-1',
      last_name: 'Lovelace',
      phone: '08012345678',
    };
    const harness = makeController({
      duplicateCustomer,
      newCustomer: { ...createEmptyNewCustomerDraft(), city: 'Lokoja' },
    });
    render(<NewOrderCustomerCreateView controller={harness.snapshot()} />);
    expect(
      screen.getByText(/add a street address to use the entered city or state/i)
    ).toBeInTheDocument();
  });

  it('surfaces an existing duplicate customer and reuses it from the banner', () => {
    const duplicateCustomer: SelectableCustomer = {
      address: '12 Allen Avenue',
      company_name: null,
      customer_type: 'individual',
      email: 'ada@example.com',
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      id: 'customer-1',
      last_name: 'Lovelace',
      phone: '08012345678',
    };
    const harness = makeController({ duplicateCustomer });
    render(<NewOrderCustomerCreateView controller={harness.snapshot()} />);
    expect(screen.getByText('⚠️ Customer Already Exists')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('08012345678')).toBeInTheDocument();
    const useExistingCustomerButton = screen
      .getByText('Use This')
      .closest('button');
    expect(useExistingCustomerButton).not.toBeNull();
    if (!useExistingCustomerButton) {
      throw new Error('Expected duplicate customer action to render.');
    }
    fireEvent.click(useExistingCustomerButton);
    expect(harness.controller.handleSelectCustomer).toHaveBeenCalledWith(
      duplicateCustomer
    );
    expect(harness.controller.setDuplicateCustomer).toHaveBeenCalledWith(null);
    expect(harness.controller.setIsCreatingCustomer).toHaveBeenCalledWith(
      false
    );
    expect(harness.controller.resetNewCustomerForm).toHaveBeenCalledTimes(1);
  });
});
