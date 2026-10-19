import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ProductAttributesCard } from '@/components/product/ProductAttributesCard';
import { ProductBasicInformationCard } from '@/components/product/ProductBasicInformationCard';
import { ProductCategorySheet } from '@/components/product/ProductCategorySheet';
import { ProductDeleteSection } from '@/components/product/ProductDeleteSection';
import { ProductFulfillmentSheet } from '@/components/product/ProductFulfillmentSheet';
import { ProductHasVariantsToggleCard } from '@/components/product/ProductHasVariantsToggleCard';
import { ProductImageCard } from '@/components/product/ProductImageCard';
import { ProductInventoryCard } from '@/components/product/ProductInventoryCard';
import { ProductPricingCard } from '@/components/product/ProductPricingCard';
import { ProductRestockSheet } from '@/components/product/ProductRestockSheet';
import { ProductStatusCard } from '@/components/product/ProductStatusCard';
import { ProductVariantsCard } from '@/components/product/ProductVariantsCard';
import { getCurrencySymbol } from '@/components/product/product-edit.helpers';
import { VariantInventoryUnitsSheet } from '@/components/product/VariantInventoryUnitsSheet';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { InvalidRouteScreen } from '@/components/ui/InvalidRouteScreen';
import { useProductEditController } from '@/hooks/useProductEditController';
import { useTheme } from '@/hooks/useTheme';

export default function ProductEditScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const controller = useProductEditController();
  const [isRestockSheetVisible, setIsRestockSheetVisible] = useState(false);
  const [isUnitsSheetVisible, setIsUnitsSheetVisible] = useState(false);

  if (!controller.id) {
    return (
      <InvalidRouteScreen
        title="Invalid Product"
        message="The product ID is invalid. Please check the link and try again."
      />
    );
  }

  if (controller.isMerchantLoading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (controller.productError) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.background,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.text }}>Error loading product</Text>
        <Text style={{ color: colors.textSecondary }}>
          {controller.productError.message}
        </Text>
      </View>
    );
  }

  const currencySymbol = getCurrencySymbol(
    controller.merchant?.payout_currency
  );
  const isSaving =
    controller.updateProductMutation.isPending ||
    controller.createProductMutation.isPending;
  const editableProductId = controller.isEditing ? controller.id : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => {
                void controller.handleSave();
              }}
              disabled={isSaving}
              style={({ pressed }) => ({
                alignItems: 'center',
                flexDirection: 'row',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              {isSaving ? (
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                  style={{ marginRight: 8 }}
                />
              ) : null}
              <Text
                style={{
                  color: colors.primary,
                  fontSize: 17,
                  fontWeight: '600',
                }}
              >
                Save
              </Text>
            </Pressable>
          ),
        }}
      />

      <AppFormScreen
        contentContainerStyle={{ gap: 16, padding: 16 }}
        edges={['bottom']}
        style={{ backgroundColor: colors.background, flex: 1 }}
      >
        <ProductImageCard
          colors={colors}
          imageUrl={controller.formData.images[0]}
          isUploading={controller.isUploading}
          onPress={controller.handleImagePick}
        />

        <ProductStatusCard
          colors={colors}
          isPending={controller.updateStatusMutation.isPending}
          onValueChange={controller.handleStatusToggle}
          status={controller.formData.status}
        />

        <ProductBasicInformationCard
          categories={controller.categories}
          colors={colors}
          formData={{
            brand: controller.formData.brand,
            category: controller.formData.category,
            category_id: controller.formData.category_id,
            color: controller.formData.color,
            description: controller.formData.description,
            name: controller.formData.name,
            sku: controller.formData.sku,
          }}
          hasVariants={controller.formData.has_variants}
          hideColorField={controller.formData.has_variants}
          isEditing={controller.isEditing}
          onChange={controller.updateBasicInformation}
          onOpenCategoryModal={() => controller.setIsCategoryModalVisible(true)}
          onOpenProduct={(productId) => router.push(`/product/${productId}`)}
          productNameSuggestions={controller.productNameSuggestions}
        />

        <ProductHasVariantsToggleCard
          colors={colors}
          formData={controller.formData}
          setFormData={controller.setFormData}
        />

        {controller.formData.has_variants ? (
          <ProductVariantsCard
            colors={colors}
            currencySymbol={currencySymbol}
            hasVariantConditionAxis={controller.hasVariantConditionAxis}
            onAddVariant={controller.addVariant}
            onAddVariantAttribute={controller.addVariantAttribute}
            onApplyVariantPricing={controller.applyVariantPricing}
            onDefaultCostPriceChange={(cost_price) =>
              controller.updatePricing({ cost_price })
            }
            onDefaultPriceChange={(price) =>
              controller.updatePricing({ price })
            }
            onGenerateVariants={controller.generateVariants}
            onRemoveVariant={controller.removeVariant}
            onRemoveVariantAttribute={controller.removeVariantAttribute}
            onUpdateVariant={controller.updateVariant}
            onUpdateVariantAttribute={controller.updateVariantAttribute}
            onUpdateVariantCondition={controller.updateVariantCondition}
            value={{
              cost_price: controller.formData.cost_price,
              price: controller.formData.price,
            }}
            variants={controller.formData.variants}
          />
        ) : (
          <>
            <ProductAttributesCard
              attributes={controller.formData.variant_attributes}
              colors={colors}
              onAdd={controller.addAttribute}
              onRemove={controller.removeAttribute}
              onUpdate={controller.updateAttribute}
            />
            <ProductPricingCard
              colors={colors}
              costPrice={controller.formData.cost_price}
              currencySymbol={currencySymbol}
              onCostPriceChange={(cost_price) =>
                controller.updatePricing({ cost_price })
              }
              onPriceChange={(price) => controller.updatePricing({ price })}
              price={controller.formData.price}
            />
            <ProductInventoryCard
              colors={colors}
              fulfillmentCount={
                controller.formData.fulfillment_details.items.length
              }
              lowStockThreshold={controller.formData.low_stock_threshold}
              manageStock={controller.formData.manage_stock}
              onLowStockThresholdChange={(low_stock_threshold) =>
                controller.updateInventory({ low_stock_threshold })
              }
              onOpenFulfillmentModal={() =>
                controller.setIsFulfillmentModalVisible(true)
              }
              onStockAdjust={controller.adjustStock}
              onToggleManageStock={(manage_stock) =>
                controller.updateInventory({ manage_stock })
              }
              stockQuantity={controller.formData.stock_quantity}
              inventoryTrackingPolicy={
                controller.product?.inventory_tracking_policy
              }
              onOpenRestockModal={() => setIsRestockSheetVisible(true)}
              onOpenUnitsModal={() => setIsUnitsSheetVisible(true)}
            />
          </>
        )}

        {editableProductId ? (
          <ProductDeleteSection
            colors={colors}
            productId={editableProductId}
            productName={controller.formData.name}
          />
        ) : null}
      </AppFormScreen>

      <ProductCategorySheet
        categories={controller.categories}
        colors={colors}
        isCreating={controller.isCreatingCategory}
        isSubmittingNewCategory={controller.createCategoryMutation.isPending}
        newCategoryName={controller.newCategoryName}
        onClose={() => controller.setIsCategoryModalVisible(false)}
        onCreateCategory={controller.handleCreateCategory}
        onNewCategoryNameChange={controller.setNewCategoryName}
        onSelect={(category) => {
          controller.updateCategory(category);
          controller.setIsCategoryModalVisible(false);
        }}
        onToggleCreateMode={() =>
          controller.setIsCreatingCategory(!controller.isCreatingCategory)
        }
        selectedCategoryId={controller.formData.category_id}
        visible={controller.isCategoryModalVisible}
      />

      <ProductFulfillmentSheet
        colors={colors}
        items={controller.formData.fulfillment_details.items}
        onClose={() => controller.setIsFulfillmentModalVisible(false)}
        onDone={() => controller.setIsFulfillmentModalVisible(false)}
        onItemChange={controller.updateFulfillmentItem}
        stockQuantity={controller.formData.stock_quantity}
        visible={controller.isFulfillmentModalVisible}
      />

      {isRestockSheetVisible ? (
        <ProductRestockSheet
          colors={colors}
          productId={controller.id}
          variantId={null}
          onClose={() => setIsRestockSheetVisible(false)}
        />
      ) : null}

      {isUnitsSheetVisible ? (
        <VariantInventoryUnitsSheet
          colors={colors}
          productId={controller.id}
          variantId={null}
          onClose={() => setIsUnitsSheetVisible(false)}
        />
      ) : null}
    </>
  );
}
