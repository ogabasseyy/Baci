// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TransactionReviewItem,
  TransactionReviewOrder,
} from '@/hooks/useTransactionReview';
import { useTransactionCostPriceEditor } from './useTransactionCostPriceEditor';

const alertMock = vi.hoisted(() => ({
  alert: vi.fn(),
}));

const updateCostPriceMock = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
}));

vi.mock('react-native', () => ({
  Alert: alertMock,
}));

vi.mock('@/hooks/useUpdateTransactionCostPrice', () => ({
  useUpdateTransactionCostPrice: () => updateCostPriceMock,
}));

const order: TransactionReviewOrder = {
  createdAt: '2026-06-30T10:00:00.000Z',
  customerEmail: 'customer@example.com',
  customerName: 'Customer',
  customerPhone: null,
  estimatedProfit: 30_000,
  id: 'order-1',
  items: [],
  missingCostCount: 0,
  orderNumber: 'ORD-1',
  paymentMethod: 'transfer',
  searchText: 'customer',
  total: 100_000,
};

const item: TransactionReviewItem = {
  costPrice: 50_000,
  costSource: 'product',
  id: 'unit-row-1',
  identifierType: 'serial',
  identifierValue: 'ABC123',
  imeiValues: [],
  name: 'Samsung Galaxy S26',
  orderItemId: 'order-item-1',
  productId: 'product-1',
  profit: 30_000,
  quantity: 1,
  revenue: 80_000,
  searchText: 'samsung',
  serialValues: ['ABC123'],
  sku: null,
  supplierName: 'slot wholesale',
  unitIndex: 0,
  variantId: 'variant-1',
};

function renderEditor() {
  return renderHook(() =>
    useTransactionCostPriceEditor({
      currencySymbol: '₦',
      formatCurrency: (amount) => `₦${amount.toLocaleString()}`,
    })
  );
}

describe('useTransactionCostPriceEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCostPriceMock.isPending = false;
    updateCostPriceMock.mutateAsync.mockResolvedValue(undefined);
  });

  it('opens and closes with formatted transaction values', () => {
    const { result } = renderEditor();

    act(() => {
      result.current.handleOpenEditor(order, item);
    });

    expect(result.current.selectedItem?.id).toBe('unit-row-1');
    expect(result.current.costPriceInput).toBe('₦50,000');
    expect(result.current.dateInput).toBe('2026-06-30');
    expect(result.current.supplierInput).toBe('Slot wholesale');

    act(() => {
      result.current.handleCloseEditor();
    });

    expect(result.current.selectedItem).toBeNull();
    expect(result.current.costPriceInput).toBe('');
  });

  it('saves unit-level cost details with the matching order item identifier', async () => {
    const { result } = renderEditor();

    act(() => {
      result.current.handleOpenEditor(order, item);
      result.current.handleChangeCostPrice('60000');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateCostPriceMock.mutateAsync).toHaveBeenCalledWith({
      costPrice: 60_000,
      identifierType: 'serial',
      identifierValue: 'ABC123',
      orderId: 'order-1',
      orderItemId: 'order-item-1',
      productId: 'product-1',
      supplierName: 'Slot wholesale',
      transactionDateIso: new Date(2026, 5, 30).toISOString(),
      unitIndex: 0,
      updateProductDefault: false,
      variantId: 'variant-1',
    });
    expect(result.current.selectedItem).toBeNull();
  });

  it('asks for confirmation before recording a loss', async () => {
    const { result } = renderEditor();

    act(() => {
      result.current.handleOpenEditor(order, item);
      result.current.handleChangeCostPrice('90000');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateCostPriceMock.mutateAsync).not.toHaveBeenCalled();
    expect(alertMock.alert).toHaveBeenCalledWith(
      'Loss detected',
      'This records a loss of ₦10,000 for Samsung Galaxy S26.',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Record loss' }),
      ])
    );

    const [, , buttons] = alertMock.alert.mock.calls[0];
    await act(async () => {
      buttons[1].onPress();
      await Promise.resolve();
    });

    expect(updateCostPriceMock.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ costPrice: 90_000 })
    );
  });

  it('keeps invalid values in the editor and shows a validation error', async () => {
    const { result } = renderEditor();

    act(() => {
      result.current.handleOpenEditor(order, item);
      result.current.handleChangeCostPrice('-1');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.saveError).toBe(
      'Enter a valid cost price (0 or greater).'
    );
    expect(updateCostPriceMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the editor open and surfaces save errors when the mutation fails', async () => {
    updateCostPriceMock.mutateAsync.mockRejectedValueOnce(
      new Error('Transaction not found')
    );
    const { result } = renderEditor();

    act(() => {
      result.current.handleOpenEditor(order, item);
      result.current.handleChangeCostPrice('60000');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateCostPriceMock.mutateAsync).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBe('Transaction not found');
    expect(result.current.selectedItem?.id).toBe('unit-row-1');
    expect(result.current.costPriceInput).toBe('₦60,000');
  });
});
