import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsScheduleFields } from './SavingsScheduleFields';
import { StartSavingsProductFields } from './StartSavingsProductFields';
import type { StartSavingsController } from './start-savings-controller.types';

type MockDateTimePickerProps = {
  mode: 'date' | 'time';
  onChange: (event: { type: 'set' }, date: Date) => void;
};

// Keep picker output deterministic: the time fixture proves HH:mm formatting,
// while the next-day date fixture proves date selection updates independently.
jest.mock('@react-native-community/datetimepicker', () => {
  return {
    __esModule: true,
    default: ({ mode, onChange }: MockDateTimePickerProps) => {
      const { Pressable, Text } = jest.requireActual(
        'react-native'
      ) as typeof import('react-native');

      return (
        <Pressable
          accessibilityLabel={`Mock ${mode} picker`}
          accessibilityRole="button"
          onPress={() =>
            onChange(
              { type: 'set' },
              mode === 'time'
                ? new Date(2026, 4, 22, 7, 0)
                : new Date(2026, 4, 23)
            )
          }
        >
          <Text>{`${mode} picker`}</Text>
        </Pressable>
      );
    },
  };
});

function createController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    debouncedSearch: 'iphone',
    frequency: 'daily',
    isProductsLoading: false,
    preferredDebitTime: '06:20',
    products: [
      {
        condition: 'Used',
        id: 'product-1',
        image: 'https://cdn.example.com/iphone.jpg',
        name: 'iPhone 13 Pro Max',
        price: 800000,
        slug: 'iphone-13-pro-max',
        variant_attributes: { storage: ['128GB', '256GB'] },
        variants: [
          {
            attributes: { storage: '128GB' },
            condition: 'used',
            id: 'variant-128',
            image: 'https://cdn.example.com/iphone-128.jpg',
            name: '128GB',
            price: 750000,
          },
          {
            attributes: { storage: '256GB' },
            condition: 'used',
            id: 'variant-256',
            image: 'https://cdn.example.com/iphone-256.jpg',
            name: '256GB',
            price: 850000,
          },
        ],
      },
    ],
    searchValue: 'iphone',
    selectProduct: jest.fn(),
    selectedProduct: null,
    variantOptionGroups: [],
    setFrequency: jest.fn(),
    setPreferredDebitTime: jest.fn(),
    setSearchValue: jest.fn(),
    setStartDate: jest.fn(),
    setTargetAmount: jest.fn(),
    startDate: '2026-05-22',
    targetAmount: '',
    ...overrides,
  } as StartSavingsController;
}

describe('StartSavingsProductFields', () => {
  it('searches and selects product suggestions', () => {
    const controller = createController();
    render(
      <StartSavingsProductFields
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.changeText(
      screen.getByRole('search', { name: 'Savings product search' }),
      'iphone 13'
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Select iPhone 13 Pro Max',
      })
    );

    expect(controller.setSearchValue).toHaveBeenCalledWith('iphone 13');
    expect(
      screen.getAllByRole('button', { name: 'Select iPhone 13 Pro Max' })
    ).toHaveLength(1);
    expect(controller.selectProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'product-1' })
    );
  });

  it('keeps device details separate from schedule controls', () => {
    const controller = createController({
      selectedProduct: {
        conditionLabel: 'Used',
        id: 'product-1',
        image: 'https://cdn.example.com/iphone.jpg',
        name: 'iPhone 13 Pro Max',
        price: 800000,
        slug: 'iphone-13-pro-max',
        variantLabel: 'Storage: 256GB',
        requiresVariantSelection: false,
        variantId: 'variant-256',
      },
    });
    render(
      <StartSavingsProductFields
        colors={Colors.light}
        controller={controller}
      />
    );

    expect(screen.getByText('THE ONE YOU’RE SAVING FOR')).toBeOnTheScreen();
    expect(screen.getByText('Used · Storage: 256GB')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Savings product search')).toBeNull();
    expect(screen.queryByLabelText('Savings debit time')).toBeNull();
    fireEvent.press(screen.getByLabelText('Change savings device'));
    expect(controller.setSearchValue).toHaveBeenCalledWith('');
    render(
      <SavingsScheduleFields colors={Colors.light} controller={controller} />
    );
    expect(screen.queryByLabelText('Savings target amount')).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose weekly savings frequency' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Savings debit time' }));
    fireEvent.press(screen.getByRole('button', { name: 'Mock time picker' }));
    fireEvent.press(screen.getByRole('button', { name: 'Savings start date' }));
    fireEvent.press(screen.getByRole('button', { name: 'Mock date picker' }));

    expect(controller.setFrequency).toHaveBeenCalledWith('weekly');
    expect(controller.setPreferredDebitTime).toHaveBeenCalledWith('07:00');
    expect(controller.setStartDate).toHaveBeenCalledWith('2026-05-23');
  });

  it('shows a loading state while product suggestions are loading', () => {
    render(
      <StartSavingsProductFields
        colors={Colors.light}
        controller={createController({ isProductsLoading: true, products: [] })}
      />
    );

    expect(screen.getByLabelText('Loading savings products')).toBeOnTheScreen();
  });

  it('shows an empty state when search has no product matches', () => {
    render(
      <StartSavingsProductFields
        colors={Colors.light}
        controller={createController({ products: [] })}
      />
    );

    expect(screen.getByText('No matching products found.')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /Select /i })
    ).not.toBeOnTheScreen();
  });

  it('offers grouped variant options for the selected product', () => {
    const selectVariantOption = jest.fn();
    const controller = createController({
      selectedProduct: {
        conditionLabel: 'Used',
        id: 'product-1',
        image: 'https://cdn.example.com/iphone.jpg',
        name: 'iPhone 13 Pro Max',
        price: 800000,
        slug: 'iphone-13-pro-max',
        requiresVariantSelection: true,
        variantId: null,
        variantLabel: 'Storage: 128GB / 256GB',
      },
      selectVariantOption,
      variantOptionGroups: [
        {
          key: 'storage',
          label: 'Storage',
          values: [
            {
              available: true,
              label: '128GB',
              selected: false,
              value: '128GB',
            },
            {
              available: true,
              label: '256GB',
              selected: false,
              value: '256GB',
            },
          ],
        },
      ],
    });
    controller.selectedCatalogProduct = controller.products[0];
    render(
      <StartSavingsProductFields
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Select Storage 256GB' })
    );

    expect(selectVariantOption).toHaveBeenCalledWith('storage', '256GB');
    expect(screen.queryByText('Choose exact variant')).toBeNull();
  });

  it('hides variant options when the product has no variant groups', () => {
    const controller = createController({
      selectedProduct: {
        conditionLabel: 'Used',
        id: 'product-1',
        image: 'https://cdn.example.com/iphone.jpg',
        name: 'iPhone 13 Pro Max',
        price: 800000,
        slug: 'iphone-13-pro-max',
        requiresVariantSelection: false,
        variantId: null,
        variantLabel: null,
      },
      selectVariantOption: jest.fn(),
      variantOptionGroups: [],
    });
    render(
      <StartSavingsProductFields
        colors={Colors.light}
        controller={controller}
      />
    );

    expect(screen.queryByText('Storage')).not.toBeOnTheScreen();
  });
});
