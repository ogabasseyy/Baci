import { fireEvent, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

const mockMerchant = vi.hoisted(() => ({
  id: 'merchant-1',
  slug: 'oldstore',
  custom_domain: undefined as string | undefined,
}));
const mockApiPost = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    merchant: mockMerchant,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

const { ChangeStoreUrl } = await import('./change-store-url');

export { ChangeStoreUrl, mockApiPost, mockMerchant, mockToast };

export function resetChangeStoreUrlTestState() {
  vi.clearAllMocks();
  mockMerchant.id = 'merchant-1';
  mockMerchant.slug = 'oldstore';
  mockMerchant.custom_domain = undefined;
}

export function typeNewSlug(value: string, label = 'New URL') {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value },
  });
}

/** Clicks the card's "Change URL" button and returns the confirmation dialog. */
export function openRenameDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Change URL' }));
  return screen.findByRole('alertdialog');
}

export function confirmRename(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change URL' }));
}
