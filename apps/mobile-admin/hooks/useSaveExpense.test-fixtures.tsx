import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { type SaveExpenseInput, useSaveExpense } from './useSaveExpense';

export const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
export const expenseId = 'd73fed74-8c83-4692-9a31-1a9ec5f1ad7a';
export const branchId = '8b3f1444-8890-4b6a-a00f-ae80949f05b2';
export const groupId = 'f4067728-3048-4f49-a6c2-0d6b891c43d7';
export const expectedUpdatedAt = '2026-08-09T10:00:00.000Z';
export const originalReceiptPath = `${merchantId}/expenses/31bc282a-c36d-4bc8-815e-731ac75d1c01.jpg`;
export const replacementReceiptPath = `${merchantId}/expenses/8a99a748-da79-4e6d-a7c6-d0a68e4e02fb.jpg`;

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

export function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

export function renderSaveExpense(queryClient = createQueryClient()) {
  return renderHook(() => useSaveExpense(), {
    wrapper: createWrapper(queryClient),
  });
}

export function validInput(): SaveExpenseInput {
  return {
    merchantId,
    mode: 'create',
    receiptChange: { kind: 'unchanged' },
    values: {
      amount: 4250,
      branchId,
      category: 'Utilities',
      date: '2026-08-09',
      description: 'Internet subscription',
      groupId,
      paymentMethod: 'Transfer',
      reference: 'INV-101',
      vendorName: 'ISP Ltd',
    },
  };
}

export function insertResponse(response: unknown) {
  return {
    insert: vi.fn().mockResolvedValue(response),
  };
}

export function updateResponse(response: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(response);
  const select = vi.fn(() => ({ maybeSingle }));
  const query = { eq: vi.fn(), select };
  query.eq.mockReturnValue(query);
  return { update: vi.fn(() => query) };
}
