import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { VariantInventoryUnitsSheet } from './VariantInventoryUnitsSheet';

const mocks = vi.hoisted(() => ({
  updateMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  useBranches: vi.fn(() => ({ data: [] as Record<string, unknown>[] })),
  useVariantInventory: vi.fn(() => ({
    data: {
      pages: [
        {
          units: [
            {
              id: 'unit-1',
              product_id: 'product-1',
              variant_id: 'variant-1',
              identifier_value: '123456789012345',
              identifier_type: 'imei',
              status: 'available',
              source: 'merchant_stock',
              notes: 'First batch',
              branch_id: 'branch-1',
              created_at: '2026-06-15T00:00:00Z',
              updated_at: '2026-06-15T00:00:00Z',
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      ],
    },
    error: null as Error | null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    refetch: vi.fn(),
  })),
  alert: vi.fn(),
}));

vi.mock('@/hooks/useBranches', () => ({
  useBranches: mocks.useBranches,
}));

vi.mock('@/hooks/variantInventory', () => ({
  useVariantInventory: mocks.useVariantInventory,
  useUpdateVariantInventoryUnit: () => ({
    mutateAsync: mocks.updateMutateAsync,
  }),
  useDeleteVariantInventoryUnit: () => ({
    mutateAsync: mocks.deleteMutateAsync,
  }),
}));

vi.mock('@/components/ui/AppPageSheet', () => ({
  AppPageSheet: ({
    children,
    onClose,
    title,
    visible,
  }: {
    children?: React.ReactNode;
    onClose: () => void;
    title: string;
    visible: boolean;
  }) =>
    visible ? (
      <section aria-label={title}>
        <button aria-label="Close sheet" onClick={onClose} type="button" />
        {children}
      </section>
    ) : null,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    Alert: {
      alert: mocks.alert,
    },
    Platform: {
      OS: 'ios',
      select<T>(objs: { ios?: T; android?: T; default?: T }) {
        return objs.ios ?? objs.default;
      },
    },
    ActivityIndicator: () => null,
    FlatList: (props: {
      data: Array<{ id?: string }>;
      renderItem: (args: { item: { id?: string } }) => React.ReactNode;
    }) => {
      const { data, renderItem } = props;
      return React.createElement(
        'ul',
        { 'aria-label': 'units-list' },
        data.map((item, index) =>
          React.createElement(
            'li',
            { key: item.id || index },
            renderItem({ item })
          )
        )
      );
    },
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
      disabled,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
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
    TextInput: ({
      accessibilityLabel,
      onChangeText,
      placeholder,
      value,
    }: {
      accessibilityLabel?: string;
      onChangeText?: (text: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        placeholder,
        value: value ?? '',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

describe('VariantInventoryUnitsSheet', () => {
  beforeEach(() => {
    mocks.alert.mockReset();
    mocks.deleteMutateAsync.mockReset();
    mocks.updateMutateAsync.mockReset();
    mocks.useBranches.mockReset();
    mocks.useBranches.mockReturnValue({ data: [] });
  });

  const colors = {
    border: '#e2e8f0',
    inputBg: '#f8fafc',
    primary: '#2563eb',
    text: '#0f172a',
    textOnPrimary: '#ffffff',
    textSecondary: '#64748b',
    background: '#ffffff',
    card: '#ffffff',
    error: '#ef4444',
    success: '#22c55e',
  } as unknown as ThemeColors;

  it('renders listed units with status and branch details', () => {
    mocks.useBranches.mockReturnValue({
      data: [{ id: 'branch-1', name: 'Branch A' }],
    });

    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );

    expect(screen.getByText('123456789012345')).toBeInTheDocument();
    expect(
      screen.getByText('IMEI • Branch A • Source: merchant_stock')
    ).toBeInTheDocument();
    expect(screen.getAllByText('AVAILABLE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Notes: First batch')).toBeInTheDocument();
  });

  it('preserves existing notes when saving another field', () => {
    mocks.updateMutateAsync.mockResolvedValueOnce({ success: true });
    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );
    fireEvent.click(screen.getByLabelText('Edit unit 123456789012345'));
    fireEvent.click(screen.getByLabelText('Select status defective'));
    fireEvent.click(screen.getByLabelText('Save unit changes'));
    expect(mocks.updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'defective', notes: 'First batch' })
    );
  });

  it('enters inline edit mode, modifies fields, and triggers update mutation', () => {
    mocks.useBranches.mockReturnValue({
      data: [
        { id: 'branch-1', name: 'Branch A' },
        { id: 'branch-2', name: 'Branch B' },
      ],
    });
    mocks.updateMutateAsync.mockResolvedValueOnce({ success: true });

    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );

    // Click Edit button
    const editBtn = screen.getByLabelText('Edit unit 123456789012345');
    fireEvent.click(editBtn);

    expect(
      screen.getByText('Editing 123456789012345 (IMEI)')
    ).toBeInTheDocument();

    // Select status defective
    const defectiveOption = screen.getByLabelText('Select status defective');
    fireEvent.click(defectiveOption);

    // Assign to Branch B
    const branchBOption = screen.getByLabelText('Assign to Branch B');
    fireEvent.click(branchBOption);

    // Change notes
    const notesInput = screen.getByLabelText('Unit notes input');
    fireEvent.change(notesInput, { target: { value: 'Damaged screen' } });

    // Save changes
    const saveBtn = screen.getByLabelText('Save unit changes');
    fireEvent.click(saveBtn);

    expect(mocks.updateMutateAsync).toHaveBeenCalledWith({
      unitId: 'unit-1',
      productId: 'product-1',
      status: 'defective',
      notes: 'Damaged screen',
      branchId: 'branch-2',
      setBranch: true,
    });
  });

  it('renders an error state with retry when inventory fetch fails', () => {
    const refetch = vi.fn();
    mocks.useVariantInventory.mockReturnValueOnce({
      data: { pages: [{ units: [], nextCursor: null, hasMore: false }] },
      error: new Error('load failed'),
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      refetch,
    });

    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );

    expect(
      screen.getByText('Could not load inventory units.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retry loading inventory units'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows an alert when updating a unit fails', async () => {
    mocks.updateMutateAsync.mockRejectedValueOnce(new Error('update failed'));

    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );

    fireEvent.click(screen.getByLabelText('Edit unit 123456789012345'));
    fireEvent.click(screen.getByLabelText('Save unit changes'));

    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith(
        'Update Failed',
        'update failed'
      );
    });
  });

  it('shows an alert when deleting a unit fails', async () => {
    mocks.deleteMutateAsync.mockRejectedValueOnce(new Error('delete failed'));
    mocks.alert.mockImplementation((_title, _msg, buttons) => {
      const deleteAction = buttons?.find(
        (btn: { text?: string; onPress?: () => void }) => btn.text === 'Delete'
      );
      deleteAction?.onPress?.();
    });

    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );

    fireEvent.click(screen.getByLabelText('Delete unit 123456789012345'));

    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith(
        'Delete Failed',
        'delete failed'
      );
    });
  });

  it('asks for delete confirmation and triggers deletion mutation', () => {
    mocks.deleteMutateAsync.mockResolvedValueOnce({ deleted: true });

    // Alert.alert trigger mock implementation
    mocks.alert.mockImplementation((_title, _msg, buttons) => {
      const deleteAction = buttons?.find(
        (btn: { text?: string; onPress?: () => void }) => btn.text === 'Delete'
      );
      if (deleteAction?.onPress) {
        deleteAction.onPress();
      }
    });

    render(
      <VariantInventoryUnitsSheet
        colors={colors}
        productId="product-1"
        onClose={vi.fn()}
        visible={true}
      />
    );

    const deleteBtn = screen.getByLabelText('Delete unit 123456789012345');
    fireEvent.click(deleteBtn);

    expect(mocks.alert).toHaveBeenCalled();
    expect(mocks.deleteMutateAsync).toHaveBeenCalledWith({
      unitId: 'unit-1',
      productId: 'product-1',
    });
  });
});
