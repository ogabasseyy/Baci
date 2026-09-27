import { describe, expect, it } from 'vitest';
import {
  mockMerchantState,
  mockProduct,
  mockStorefrontUiState,
  previewMerchantState,
  resetProductGridTestState,
} from './product-grid-test-fixtures';

describe('product-grid-test-fixtures', () => {
  it('resets shared arrange-state between tests', () => {
    mockStorefrontUiState.searchQuery = 'phones';
    mockStorefrontUiState.selectedCategory = 'Smartphones';

    resetProductGridTestState();

    expect(mockStorefrontUiState.searchQuery).toBe('');
    expect(mockStorefrontUiState.selectedCategory).toBe('All');
    expect(mockMerchantState.basePath).toBe('');
  });

  it('provides a product and a preview merchant with identity fields', () => {
    expect(mockProduct.id).not.toBe('');
    expect(mockProduct.name).not.toBe('');
    expect(previewMerchantState().slug).toBe('preview-store');
  });
});
