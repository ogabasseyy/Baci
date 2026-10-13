import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewOrderQuickAddDialog } from './NewOrderQuickAddDialog';
import {
  makeQuickAddDialogController as makeController,
  quickAddProductMatch,
} from './NewOrderQuickAddDialog.test-fixtures';

const keyboardState = vi.hoisted(() => ({
  dismiss: vi.fn(),
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    Keyboard: { dismiss: keyboardState.dismiss },
    StatusBar: () => null,
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
        {
          'aria-label': accessibilityLabel,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: React.forwardRef(
      (
        {
          onChangeText,
          onSubmitEditing,
          placeholder,
          returnKeyType,
          multiline,
          scrollEnabled,
          submitBehavior,
          value,
        }: {
          onChangeText?: (text: string) => void;
          onSubmitEditing?: () => void;
          placeholder?: string;
          returnKeyType?: string;
          multiline?: boolean;
          scrollEnabled?: boolean;
          submitBehavior?: string;
          value?: string;
        },
        ref: React.Ref<HTMLInputElement>
      ) =>
        React.createElement('input', {
          'data-return-key-type': returnKeyType,
          'data-multiline': multiline ? 'true' : 'false',
          'data-scroll-enabled': scrollEnabled ? 'true' : 'false',
          'data-submit-behavior': submitBehavior,
          onChange: (event: { target: { value: string } }) =>
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
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/ui/AppDialogModal', () => ({
  AppDialogModal: ({
    children,
    visible,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
  }) => (visible ? React.createElement('div', null, children) : null),
}));

vi.mock('./new-order.styles', () => ({ styles: {} }));
vi.mock('./new-order.shared', () => ({
  formatPriceInput: (value: string | undefined) => value ?? '',
  parseDecimalInput: (text: string) => text.replace(/[^0-9.]/g, ''),
}));

describe('NewOrderQuickAddDialog', () => {
  beforeEach(() => {
    keyboardState.dismiss.mockReset();
  });

  it('renders the dialog with title and inputs when visible', () => {
    const controller = makeController();

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    expect(screen.getByText('Quick Add Item')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Item Name (e.g. Red Cake, Delivery)')
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Amount (0.00)')).toBeInTheDocument();
    expect(screen.getByText('NGN')).toBeInTheDocument();
  });

  it('lets long item names wrap and shows the merchant store currency', () => {
    const controller = makeController({
      merchant: { payout_currency: ' usd ' },
    });

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    const nameInput = screen.getByPlaceholderText(
      'Item Name (e.g. Red Cake, Delivery)'
    );
    expect(nameInput).toHaveAttribute('data-multiline', 'true');
    expect(nameInput).toHaveAttribute('data-scroll-enabled', 'false');
    expect(screen.getByText('USD')).toBeInTheDocument();
  });

  it('moves focus from item name to amount and dismisses from the final input', () => {
    const controller = makeController();

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    const nameInput = screen.getByPlaceholderText(
      'Item Name (e.g. Red Cake, Delivery)'
    );
    const priceInput = screen.getByPlaceholderText('Amount (0.00)');

    expect(nameInput).toHaveAttribute('data-return-key-type', 'next');
    expect(nameInput).toHaveAttribute('data-submit-behavior', 'submit');
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(priceInput).toHaveFocus();

    expect(priceInput).toHaveAttribute('data-return-key-type', 'done');
    expect(priceInput).toHaveAttribute('data-submit-behavior', 'blurAndSubmit');
    fireEvent.keyDown(priceInput, { key: 'Enter' });
    expect(keyboardState.dismiss).toHaveBeenCalledTimes(1);
    expect(controller.handleContinueAsCustomItem).not.toHaveBeenCalled();
  });

  it('does not render when showCustomItemModal is false', () => {
    const controller = makeController({ showCustomItemModal: false });

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    expect(screen.queryByText('Quick Add Item')).not.toBeInTheDocument();
  });

  it('rejects non-numeric characters in the price input', () => {
    const controller = makeController();

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    const priceInput = screen.getByPlaceholderText('Amount (0.00)');
    fireEvent.change(priceInput, { target: { value: 'abc' } });

    expect(controller.setCustomItem).toHaveBeenCalledTimes(1);
    const updater = controller.setCustomItem.mock.calls[0][0] as (prev: {
      name: string;
      price: string;
    }) => { name: string; price: string };
    const result = updater({ name: '', price: '' });
    expect(result.price).toBe('');
  });

  it('calls handleContinueAsCustomItem when "Add to Cart" is pressed', () => {
    const controller = makeController({
      customItem: { name: 'Delivery', price: '500' },
    });

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));

    expect(controller.handleContinueAsCustomItem).toHaveBeenCalledTimes(1);
  });

  it('shows matching products and lets the merchant use an existing row', () => {
    const controller = makeController({
      customItem: { name: 'iPhone 11 Pro 64gb Premium Used', price: '180000' },
      quickAddProductMatches: [quickAddProductMatch],
    });

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    expect(screen.getByText('This item may already exist')).toBeInTheDocument();
    expect(
      screen.getByText('iPhone 11 Pro 64GB Premium Used')
    ).toBeInTheDocument();
    expect(screen.getByText('variant and price')).toBeInTheDocument();
    expect(screen.getByText('₦180,000')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /use existing product iphone 11 pro 64gb premium used/i,
      })
    );

    expect(controller.handleUseQuickAddProductMatch).toHaveBeenCalledWith(
      quickAddProductMatch
    );
    expect(
      screen.getByRole('button', { name: 'Continue as Custom' })
    ).toBeInTheDocument();
  });

  it('shows a catalog check message while quick-add matches load', () => {
    const controller = makeController({
      isLoadingQuickAddProductMatches: true,
    });

    render(
      <NewOrderQuickAddDialog
        controller={
          controller as unknown as React.ComponentProps<
            typeof NewOrderQuickAddDialog
          >['controller']
        }
      />
    );

    expect(screen.getByText('Checking product catalog…')).toBeInTheDocument();
  });
});
