import type React from 'react';

function Text({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

/** Stub transaction components shared by TransactionsScreen suites. */
export const transactionsScreenTestComponents = {
  TransactionsSummary: ({
    activeTab,
    estimatedProfitLabel,
    onTabChange,
    summary,
  }: {
    activeTab?: 'paid' | 'missing-costs';
    estimatedProfitLabel: string;
    onTabChange?: (tab: 'paid' | 'missing-costs') => void;
    summary: { missingCosts: number; transactions: number };
  }) => (
    <div>
      <button
        aria-pressed={activeTab === 'paid'}
        type="button"
        onClick={() => onTabChange?.('paid')}
      >
        <Text>Paid transactions tab</Text>
      </button>
      <button
        aria-pressed={activeTab === 'missing-costs'}
        type="button"
        onClick={() => onTabChange?.('missing-costs')}
      >
        <Text>Missing costs tab</Text>
      </button>
      <Text>{estimatedProfitLabel}</Text>
      <Text>{`${summary.transactions} transactions`}</Text>
      <Text>{`${summary.missingCosts} missing costs`}</Text>
    </div>
  ),
  TransactionOrderCard: ({
    onOpenEditor,
    order,
  }: {
    onOpenEditor: (
      order: {
        createdAt: string;
        id: string;
      },
      item: {
        costPrice: number | null;
        id: string;
        name: string;
        productId: string | null;
        supplierName: string;
        variantId: string | null;
      }
    ) => void;
    order: {
      createdAt: string;
      id: string;
      items: Array<{
        costPrice: number | null;
        id: string;
        name: string;
        productId: string | null;
        supplierName: string;
        variantId: string | null;
      }>;
      orderNumber: string;
    };
  }) => (
    <div>
      <button type="button" onClick={() => onOpenEditor(order, order.items[0])}>
        <Text>{`Edit ${order.orderNumber}`}</Text>
      </button>
      {order.items.map((item) => (
        <Text key={item.id}>{item.name}</Text>
      ))}
    </div>
  ),
  CostPriceEditorModal: ({
    costPriceInput,
    dateInput,
    onChangeCostPrice,
    onChangeDate,
    onChangeSupplier,
    onClose,
    onSave,
    saveError,
    supplierInput,
    visible,
  }: {
    costPriceInput: string;
    dateInput?: string;
    onChangeCostPrice: (value: string) => void;
    onChangeDate?: (value: string) => void;
    onChangeSupplier?: (value: string) => void;
    onClose: () => void;
    onSave: () => void;
    saveError: string | null;
    supplierInput?: string;
    visible: boolean;
  }) =>
    visible ? (
      <div>
        <input
          aria-label="Cost price input"
          value={costPriceInput}
          onChange={(event) => onChangeCostPrice(event.target.value)}
        />
        <input
          aria-label="Transaction date input"
          value={dateInput ?? ''}
          onChange={(event) => onChangeDate?.(event.target.value)}
        />
        <input
          aria-label="Vendor or supplier input"
          value={supplierInput ?? ''}
          onChange={(event) => onChangeSupplier?.(event.target.value)}
        />
        {saveError ? <Text>{saveError}</Text> : null}
        <button type="button" onClick={onSave}>
          <Text>Save cost price</Text>
        </button>
        <button type="button" onClick={onClose}>
          <Text>Close editor</Text>
        </button>
      </div>
    ) : null,
};
