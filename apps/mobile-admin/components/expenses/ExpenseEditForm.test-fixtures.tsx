import type { ComponentProps, ReactNode } from 'react';
import { vi } from 'vitest';
import type { ExpenseFormFields } from '@/components/expenses/ExpenseFormFields';
import type { ExpenseDetail } from '@/schemas/expense-detail';

export const editMerchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
export const editExpenseId = '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9';
export const editBranchId = '8b3f1444-8890-4b6a-a00f-ae80949f05b2';
export const editGroupId = 'f4067728-3048-4f49-a6c2-0d6b891c43d7';

export const editExpense: ExpenseDetail = {
  amount: 4250,
  branch_id: editBranchId,
  category: 'Utilities',
  created_by_user_id: null,
  date: '2026-08-08',
  description: 'Internet subscription',
  group_id: editGroupId,
  id: editExpenseId,
  merchant_id: editMerchantId,
  payment_method: 'Transfer',
  receipt_storage_path: `${editMerchantId}/expenses/receipt.jpg`,
  receipt_url: null,
  reference: 'INV-101',
  updated_at: '2026-08-08T12:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: 'ISP Ltd',
};

const editFormMocks = vi.hoisted(() => ({
  archiveGroup: vi.fn(),
  alert: vi.fn(),
  branchesData: [
    {
      active: true,
      id: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
      is_default: true,
      name: 'Lagos main',
    },
  ] as
    | Array<{
        active: boolean;
        id: string;
        is_default: boolean;
        name: string;
      }>
    | undefined,
  branchesError: null as Error | null,
  groupsError: null as Error | null,
  hasCachedGroups: true,
  imagePicker: vi.fn(),
  isPending: false,
  mutate: vi.fn(),
  privateReceiptUrl: 'https://signed.example.com/receipt.jpg',
  preventRemoveCallback: null as (() => void) | null,
  preventRemoveEnabled: false,
  router: { back: vi.fn() },
  dispatch: vi.fn(),
}));

export function getExpenseEditFormMocks() {
  return editFormMocks;
}

type FieldsProps = ComponentProps<typeof ExpenseFormFields>;

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#020617',
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      text: '#f8fafc',
      textOnPrimary: '#fff',
      textSecondary: '#cbd5e1',
    },
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: editMerchantId } }),
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'branch', branchId: editBranchId } }),
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({
    data: editFormMocks.branchesData,
    isLoading: false,
    error: editFormMocks.branchesError,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => ({
    activeGroups: [],
    allGroups: editFormMocks.hasCachedGroups
      ? [
          {
            archived_at: '2026-08-09T00:00:00.000Z',
            created_at: '2026-08-01T00:00:00.000Z',
            id: editGroupId,
            merchant_id: editMerchantId,
            name: 'Archived marketing',
            updated_at: '2026-08-09T00:00:00.000Z',
          },
        ]
      : [],
    archiveGroup: editFormMocks.archiveGroup,
    createGroup: vi.fn(),
    error: editFormMocks.groupsError,
    hasCachedGroups: editFormMocks.hasCachedGroups,
    refetch: vi.fn(),
    renameGroup: vi.fn(),
  }),
}));
vi.mock('@/hooks/useExpenseReceiptUrl', () => ({
  useExpenseReceiptUrl: ({
    legacyReceiptUrl,
    receiptStoragePath,
  }: {
    legacyReceiptUrl: string | null;
    receiptStoragePath: string | null;
  }) => ({
    url: receiptStoragePath
      ? editFormMocks.privateReceiptUrl
      : legacyReceiptUrl,
    error: null,
    isLoading: false,
  }),
}));
vi.mock('@/hooks/useSaveExpense', () => ({
  useSaveExpense: () => ({
    isPending: editFormMocks.isPending,
    mutate: editFormMocks.mutate,
  }),
}));
vi.mock('@/components/ui/AppFormScreen', () => ({
  AppFormScreen: ({
    children,
    footer,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
  }) => (
    <section aria-label="edit expense form">
      {children}
      {footer}
    </section>
  ),
}));
vi.mock('@/components/expenses/ExpenseFormFields', () => ({
  ExpenseFormFields: (props: FieldsProps) => (
    <>
      <output aria-label="preloaded amount">{props.amount}</output>
      <output aria-label="receipt preview">{props.existingReceiptUri}</output>
      <output aria-label="receipt change">{props.receiptChange?.kind}</output>
      <input
        aria-label="Expense amount"
        onChange={(event) => props.onAmountChange(event.target.value)}
        value={props.amount}
      />
      <input
        aria-label="Expense description"
        onChange={(event) => props.onDescriptionChange(event.target.value)}
        value={props.description}
      />
      <input
        aria-label="Expense vendor or payee"
        onChange={(event) => props.onVendorNameChange?.(event.target.value)}
        value={props.vendorName}
      />
      <input
        aria-label="Expense payment method"
        onChange={(event) => props.onPaymentMethodChange?.(event.target.value)}
        value={props.paymentMethod}
      />
      <input
        aria-label="Expense reference"
        onChange={(event) => props.onReferenceChange?.(event.target.value)}
        value={props.reference}
      />
      <output aria-label="selected category">{props.selectedCategory}</output>
      <button onClick={props.onReceiptRemove} type="button">
        Remove receipt
      </button>
      <button onClick={props.onReceiptRestore} type="button">
        Restore receipt
      </button>
      <button onClick={props.onReceiptPress} type="button">
        Replace receipt
      </button>
      <button onClick={props.onManageGroups} type="button">
        Choose group
      </button>
    </>
  ),
}));
vi.mock('@/components/expenses/ExpenseCategorySheet', () => ({
  ExpenseCategorySheet: () => null,
}));
vi.mock('@/components/expenses/ExpenseGroupManagerSheet', () => ({
  ExpenseGroupManagerSheet: ({
    archiveGroup,
  }: {
    archiveGroup: (id: string) => Promise<void>;
  }) => (
    <button onClick={() => void archiveGroup(editGroupId)} type="button">
      Archive selected group
    </button>
  ),
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: editFormMocks.imagePicker,
}));
vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) => (
      <>{options?.headerLeft?.()}</>
    ),
  },
  useNavigation: () => ({ dispatch: editFormMocks.dispatch }),
  useRouter: () => editFormMocks.router,
}));
vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    editFormMocks.preventRemoveEnabled = prevent;
    editFormMocks.preventRemoveCallback = callback;
  },
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('react-native', () => ({
  ActivityIndicator: () => <output aria-label="saving" />,
  Alert: { alert: editFormMocks.alert },
  Pressable: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (value: unknown) => value },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

export function resetExpenseEditFormMocks() {
  vi.clearAllMocks();
  editFormMocks.imagePicker.mockResolvedValue({ canceled: true });
  editFormMocks.archiveGroup.mockResolvedValue(undefined);
  editFormMocks.branchesData = [
    {
      active: true,
      id: editBranchId,
      is_default: true,
      name: 'Lagos main',
    },
  ];
  editFormMocks.branchesError = null;
  editFormMocks.groupsError = null;
  editFormMocks.hasCachedGroups = true;
  editFormMocks.isPending = false;
  editFormMocks.mutate.mockImplementation(
    (_input: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.()
  );
  editFormMocks.privateReceiptUrl = 'https://signed.example.com/receipt.jpg';
  editFormMocks.preventRemoveEnabled = false;
  editFormMocks.preventRemoveCallback = null;
}
