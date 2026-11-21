import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialProductEditFormData } from '@/components/product/product-edit.defaults';
import { createProductEditPersistenceActions } from './createProductEditPersistenceActions';

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('variants that leave an option blank', () => {
  const buildVariant = (attributes: Record<string, string>) => ({
    attributes: Object.entries(attributes).map(([key, value]) => ({
      key,
      value,
    })),
    client_id: `variant-${JSON.stringify(attributes)}`,
    cost_price: 0,
    images: [],
    price: 1000,
    primary_image: null,
    sku: '',
    stock_quantity: 1,
  });

  const buildActions = (
    variants: ReturnType<typeof buildVariant>[],
    updateProduct = vi.fn().mockResolvedValue(undefined)
  ) => ({
    updateProduct,
    actions: createProductEditPersistenceActions({
      createCategory: vi.fn(),
      createProduct: vi.fn(),
      formData: {
        ...createInitialProductEditFormData(),
        has_variants: true,
        name: 'PlayStation 5 Console',
        price: 640000,
        variants,
      },
      hasVariantConditionAxis: false,
      id: 'product-1',
      isEditing: true,
      newCategoryName: '',
      openProduct: vi.fn(),
      resetCategoryForm: vi.fn(),
      revertStatus: vi.fn(),
      routerBack: vi.fn(),
      saveInFlightRef: { current: false },
      selectCreatedCategory: vi.fn(),
      updateProduct,
      updateStatus: vi.fn(),
    }),
  });

  it('warns instead of saving when one variant has no region but the others do', async () => {
    const { actions, updateProduct } = buildActions([
      buildVariant({ storage: '1TB', region: 'Europe' }),
      buildVariant({ storage: '1TB', region: 'Japan' }),
      buildVariant({ storage: '825GB', region: '' }),
    ]);

    await actions.handleSave();

    expect(updateProduct).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = vi.mocked(Alert.alert).mock.calls[0];
    expect(title).toBe('Missing variant options');
    expect(message).toContain('Variant 3: Region');
    expect(buttons?.map((button) => button.text)).toEqual([
      'Go back and fix',
      'Save anyway',
    ]);
  });

  it('saves when the merchant chooses Save anyway', async () => {
    const { actions, updateProduct } = buildActions([
      buildVariant({ storage: '1TB', region: 'Europe' }),
      buildVariant({ storage: '825GB' }),
    ]);

    await actions.handleSave();
    const buttons = vi.mocked(Alert.alert).mock.calls[0][2];
    buttons?.find((button) => button.text === 'Save anyway')?.onPress?.();

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
  });

  it('saves straight away when every variant fills the same options', async () => {
    const { actions, updateProduct } = buildActions([
      buildVariant({ storage: '1TB', region: 'Europe' }),
      buildVariant({ storage: '825GB', region: 'Japan' }),
    ]);

    await actions.handleSave();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Missing variant options',
      expect.anything(),
      expect.anything()
    );
  });
});
