import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SheetTextInputRef } from '@/components/ui/SheetTextInput';
import type { NewOrderController } from '@/hooks/useNewOrderController';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';
import {
  buildVariantOptionGroups,
  resolveSelectedVariant,
  selectVariantOption,
  type VariantOptionSelection,
} from '@/lib/product-variant-option-selector';
import { NewOrderCreateProductRow } from './NewOrderCreateProductRow';
import { NewOrderProductPickerList } from './NewOrderProductPickerList';
import { NewOrderProductPickerSheetFrame } from './NewOrderProductPickerSheetFrame';
import { NewOrderProductSearchFooter } from './NewOrderProductSearchFooter';
import { ProductVariantOptionSelector } from './ProductVariantOptionSelector';
import { ProductVariantSelectionFooter } from './ProductVariantSelectionFooter';

const PRODUCT_PICKER_FOOTER_BOTTOM_INSET = 18;
export const PRODUCT_SEARCH_FOCUS_DELAY_MS = 250;

export type NewOrderProductSheetController = Pick<
  NewOrderController,
  | 'closeProductModal'
  | 'colors'
  | 'fetchMoreProducts'
  | 'formatPrice'
  | 'handleAddProduct'
  | 'handleSelectProduct'
  | 'hasMoreProducts'
  | 'isFetchingMoreProducts'
  | 'isLoadingSelectedParentProduct'
  | 'isPickingVariant'
  | 'isProductsLoading'
  | 'productSearch'
  | 'productsError'
  | 'refetchProducts'
  | 'refetchSelectedParentProduct'
  | 'resetProductPickerState'
  | 'selectableProductRows'
  | 'selectedParentProduct'
  | 'selectedParentProductError'
  | 'setProductSearch'
  | 'showProductModal'
>;

export function NewOrderProductSheet({
  controller,
}: {
  controller: NewOrderProductSheetController;
}) {
  const inputRef = useRef<SheetTextInputRef | null | undefined>(null);
  const [variantSelectionState, setVariantSelectionState] = useState<{
    parentProductId?: string;
    selection: VariantOptionSelection;
  }>({ selection: {} });

  const {
    closeProductModal,
    colors,
    formatPrice,
    handleAddProduct,
    isPickingVariant,
    productSearch,
    resetProductPickerState,
    selectableProductRows,
    selectedParentProduct,
    setProductSearch,
    showProductModal,
  } = controller;
  const productSearchFooter = !isPickingVariant ? (
    <NewOrderProductSearchFooter
      colors={colors}
      inputRef={inputRef}
      productSearch={productSearch}
      setProductSearch={setProductSearch}
    />
  ) : null;
  const structuredVariantRows: AdminProductVariant[] =
    isPickingVariant && selectedParentProduct
      ? selectableProductRows.map(
          (row): AdminProductVariant => ({
            ...row,
            cost_price: null,
            images: row.images ?? [],
            parent_product_id:
              row.parent_product_id ?? selectedParentProduct.id ?? null,
            primary_image: row.images?.[0] ?? null,
            source: 'structured',
            stock_quantity: 0,
          })
        )
      : [];
  const selectedParentProductId = selectedParentProduct?.id;
  const variantSelection =
    variantSelectionState.parentProductId === selectedParentProductId
      ? variantSelectionState.selection
      : {};
  const variantOptionGroups =
    structuredVariantRows.length > 0
      ? buildVariantOptionGroups(structuredVariantRows, variantSelection, {
          declaration: selectedParentProduct?.variant_attributes,
        })
      : [];
  const selectedVariant = resolveSelectedVariant(
    structuredVariantRows,
    variantSelection,
    { declaration: selectedParentProduct?.variant_attributes }
  );
  const showProductFirstVariantSelector = Boolean(
    isPickingVariant &&
      selectedParentProduct &&
      variantOptionGroups.some((group) => group.values.length > 1)
  );
  useEffect(() => {
    if (!showProductModal || !isPickingVariant) {
      setVariantSelectionState({ selection: {} });
    }
  }, [showProductModal, isPickingVariant]);
  useEffect(() => {
    if (showProductModal && !isPickingVariant) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, PRODUCT_SEARCH_FOCUS_DELAY_MS);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [showProductModal, isPickingVariant]);
  const addSelectedVariant = () => {
    if (!(selectedVariant && selectedParentProduct)) {
      return;
    }

    handleAddProduct({
      ...selectedVariant,
      images:
        selectedVariant.images.length > 0
          ? selectedVariant.images
          : (selectedParentProduct.images ?? []),
    });
  };
  const variantSelectionFooter = showProductFirstVariantSelector ? (
    <ProductVariantSelectionFooter
      colors={colors}
      onAdd={addSelectedVariant}
      selectedVariant={selectedVariant}
    />
  ) : null;

  return (
    <NewOrderProductPickerSheetFrame
      closeLabel="Close product sheet"
      colors={colors}
      footer={productSearchFooter ?? variantSelectionFooter}
      footerBottomInset={PRODUCT_PICKER_FOOTER_BOTTOM_INSET}
      leadingAccessory={
        isPickingVariant ? (
          <Pressable
            accessibilityLabel="Back to product list"
            accessibilityRole="button"
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            onPress={resetProductPickerState}
          >
            <Ionicons color={colors.text} name="chevron-back" size={24} />
          </Pressable>
        ) : null
      }
      onClose={closeProductModal}
      title={isPickingVariant ? 'Choose Variant' : 'Select Item'}
      trailingAccessory={
        isPickingVariant ? (
          <Pressable
            accessibilityLabel="Close product sheet"
            accessibilityRole="button"
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            onPress={closeProductModal}
            style={{
              alignItems: 'center',
              backgroundColor: `${colors.text}10`,
              borderRadius: 999,
              height: 36,
              justifyContent: 'center',
              width: 36,
            }}
          >
            <Ionicons color={colors.text} name="close" size={22} />
          </Pressable>
        ) : null
      }
      visible={showProductModal}
    >
      <View style={{ flex: 1 }}>
        {selectedParentProduct && !showProductFirstVariantSelector ? (
          <Text
            numberOfLines={1}
            style={{
              color: colors.textSecondary,
              fontSize: 12,
              marginBottom: 12,
              paddingHorizontal: 16,
            }}
          >
            {selectedParentProduct.name}
          </Text>
        ) : null}

        {!isPickingVariant ? (
          <NewOrderCreateProductRow
            colors={colors}
            onPress={() => {
              closeProductModal();
              router.push('/product/new');
            }}
          />
        ) : null}

        {showProductFirstVariantSelector && selectedParentProduct ? (
          <ProductVariantOptionSelector
            colors={colors}
            formatPrice={formatPrice}
            onSelect={(key, value) => {
              setVariantSelectionState((current) => ({
                parentProductId: selectedParentProduct.id,
                selection: selectVariantOption(
                  structuredVariantRows,
                  current.parentProductId === selectedParentProduct.id
                    ? current.selection
                    : {},
                  key,
                  value,
                  { declaration: selectedParentProduct.variant_attributes }
                ),
              }));
            }}
            parentProduct={selectedParentProduct}
            selectedVariant={selectedVariant}
            variantOptionGroups={variantOptionGroups}
          />
        ) : (
          <NewOrderProductPickerList controller={controller} />
        )}
      </View>
    </NewOrderProductPickerSheetFrame>
  );
}
