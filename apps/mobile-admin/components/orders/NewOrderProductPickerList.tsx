import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  getProductPickerRowSubtitle,
  getProductPickerRowTitle,
} from '@/lib/order-product-picker';
import type { NewOrderProductSheetController } from './NewOrderProductSheet';
import { NewOrderProductSheetEmptyState } from './NewOrderProductSheetEmptyState';
import { MODAL_FLATLIST_PROPS } from './new-order.shared';
import { styles } from './new-order.styles';

const PRODUCT_PICKER_LIST_BOTTOM_PADDING = 128;
const PRODUCT_PICKER_ROW_HEIGHT = 64;
const PRODUCT_PICKER_VARIANT_ROW_HEIGHT = 72;

interface NewOrderProductPickerListProps {
  controller: NewOrderProductSheetController;
}

export function NewOrderProductPickerList({
  controller,
}: NewOrderProductPickerListProps) {
  const {
    colors,
    fetchMoreProducts,
    formatPrice,
    handleAddProduct,
    handleSelectProduct,
    hasMoreProducts,
    isFetchingMoreProducts,
    isPickingVariant,
    selectableProductRows,
    selectedParentProduct,
  } = controller;
  const productPickerRowHeight = isPickingVariant
    ? PRODUCT_PICKER_VARIANT_ROW_HEIGHT
    : PRODUCT_PICKER_ROW_HEIGHT;

  return (
    <View style={{ flex: 1 }}>
      <BottomSheetFlatList
        getItemLayout={(_data, index) => ({
          index,
          length: productPickerRowHeight,
          offset: productPickerRowHeight * index,
        })}
        {...MODAL_FLATLIST_PROPS}
        contentContainerStyle={{
          paddingBottom: PRODUCT_PICKER_LIST_BOTTOM_PADDING,
        }}
        data={selectableProductRows}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <NewOrderProductSheetEmptyState controller={controller} />
        }
        ListFooterComponent={
          !isPickingVariant && isFetchingMoreProducts ? (
            <ActivityIndicator
              color={colors.primary}
              size="small"
              style={{ paddingVertical: 16 }}
            />
          ) : undefined
        }
        onEndReached={() => {
          if (!isPickingVariant && hasMoreProducts && !isFetchingMoreProducts) {
            void fetchMoreProducts();
          }
        }}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => {
          const pickerTitle = getProductPickerRowTitle(
            item,
            selectedParentProduct?.name
          );
          const pickerSubtitle = getProductPickerRowSubtitle(item);
          const showPickerSubtitle =
            isPickingVariant && pickerSubtitle !== 'N/A';

          return (
            <Pressable
              accessibilityLabel={
                isPickingVariant
                  ? `Add ${pickerTitle}`
                  : `Select ${pickerTitle}`
              }
              accessibilityRole="button"
              onPress={() =>
                isPickingVariant
                  ? handleAddProduct({
                      ...item,
                      images:
                        item.images?.length > 0
                          ? item.images
                          : (selectedParentProduct?.images ?? []),
                      parent_product_id:
                        item.parent_product_id ??
                        selectedParentProduct?.id ??
                        null,
                    })
                  : handleSelectProduct(item)
              }
              style={[
                styles.productItem,
                {
                  borderBottomColor: colors.border,
                  height: productPickerRowHeight,
                },
              ]}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.text, fontSize: 16 }}
                >
                  {pickerTitle}
                </Text>
                {showPickerSubtitle ? (
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.textSecondary, fontSize: 12 }}
                  >
                    {pickerSubtitle}
                  </Text>
                ) : null}
              </View>
              <Text style={{ color: colors.text, fontWeight: '500' }}>
                {formatPrice(item.price)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
