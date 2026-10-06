import type { useStartSavingsController } from './use-start-savings-controller';

export type StartSavingsController = ReturnType<
  typeof useStartSavingsController
>;

export type StartSavingsProductController = Pick<
  StartSavingsController,
  | 'searchValue'
  | 'setSearchValue'
  | 'selectedProduct'
  | 'selectedCatalogProduct'
  | 'selectProduct'
  | 'products'
  | 'debouncedSearch'
  | 'isProductsLoading'
>;

export type LocalSavingsFormController = StartSavingsProductController & {
  formError: string | null;
  isSubmitting: boolean;
  canContinue: boolean;
  handleContinue: () => void;
};
