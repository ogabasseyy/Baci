import { vi } from 'vitest';

export type QuickAddDialogController = {
  colors: {
    card: string;
    border: string;
    inputBg: string;
    success: string;
    text: string;
    textMuted: string;
    textOnPrimary: string;
    textSecondary: string;
  };
  formatPrice: (amount: number) => string;
  customItem: { name: string; price: string };
  handleAddCustomItem: ReturnType<typeof vi.fn>;
  handleContinueAsCustomItem: ReturnType<typeof vi.fn>;
  handleUseQuickAddProductMatch: ReturnType<typeof vi.fn>;
  isLoadingQuickAddProductMatches: boolean;
  merchant?: { payout_currency?: string | null } | null;
  quickAddProductMatches: Array<{
    condition?: string | null;
    has_variants: boolean;
    id: string;
    images: string[];
    matchReason: 'exact-name' | 'token-match' | 'variant-and-price';
    name: string;
    parent_product_id?: string | null;
    price: number;
    score: number;
    sku: string | null;
    variant_attributes: unknown;
  }>;
  setCustomItem: ReturnType<typeof vi.fn>;
  setShowCustomItemModal: ReturnType<typeof vi.fn>;
  showCustomItemModal: boolean;
};

export const makeQuickAddDialogController = (
  overrides: Partial<QuickAddDialogController> = {}
): QuickAddDialogController => ({
  colors: {
    border: '#e2e8f0',
    card: '#ffffff',
    inputBg: '#f8fafc',
    success: '#16a34a',
    text: '#0f172a',
    textMuted: '#94a3b8',
    textOnPrimary: '#ffffff',
    textSecondary: '#64748b',
  },
  customItem: { name: '', price: '' },
  formatPrice: (amount) => `₦${amount.toLocaleString('en-US')}`,
  handleAddCustomItem: vi.fn(),
  handleContinueAsCustomItem: vi.fn(),
  handleUseQuickAddProductMatch: vi.fn(),
  isLoadingQuickAddProductMatches: false,
  merchant: { payout_currency: 'NGN' },
  quickAddProductMatches: [],
  setCustomItem: vi.fn(),
  setShowCustomItemModal: vi.fn(),
  showCustomItemModal: true,
  ...overrides,
});

export const quickAddProductMatch = {
  condition: null,
  has_variants: false,
  id: 'product-1',
  images: [],
  matchReason: 'variant-and-price' as const,
  name: 'iPhone 11 Pro 64GB Premium Used',
  parent_product_id: 'iphone-11-pro',
  price: 180000,
  score: 90,
  sku: null,
  variant_attributes: { storage: '64GB' },
};
