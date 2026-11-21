import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import { z } from 'zod';
import type { ProductEditFormData } from '@/components/product/product-edit.types';
import { runSingleFlight } from '@/lib/single-flight';
import { describeVariantOptionGaps } from '@/lib/variant-option-gap-warning';

interface CreateProductEditPersistenceActionsParams {
  createCategory: (
    name: string,
    callbacks: {
      onSuccess: (newCategory: { id: string; name: string }) => void;
      onError: (error: Error) => void;
    }
  ) => void;
  createProduct: (input: ProductEditFormData) => Promise<unknown>;
  exactProductSuggestion?: { id: string; name: string };
  formData: ProductEditFormData;
  hasVariantConditionAxis: boolean;
  id?: string;
  isEditing: boolean;
  newCategoryName: string;
  openProduct: (productId: string) => void;
  productCreationGate?: {
    allowed: boolean;
    limit: number;
    onUpgrade: () => void;
    requiresUpgrade: boolean;
  };
  resetCategoryForm: () => void;
  // Called with nextStatus for optimistic update, called with previousStatus on error revert
  revertStatus: (status: 'active' | 'draft' | 'archived') => void;
  routerBack: () => void;
  saveInFlightRef: MutableRefObject<boolean>;
  selectCreatedCategory: (categoryId: string, categoryName: string) => void;
  updateProduct: (input: {
    id: string;
    updates: ProductEditFormData;
  }) => Promise<unknown>;
  updateStatus: (
    input: { productId: string; status: 'active' | 'draft' },
    callbacks: { onError: (error: unknown) => void }
  ) => void;
}

export function createProductEditPersistenceActions({
  createCategory,
  createProduct,
  exactProductSuggestion,
  formData,
  hasVariantConditionAxis,
  id,
  isEditing,
  newCategoryName,
  openProduct,
  productCreationGate,
  resetCategoryForm,
  revertStatus,
  routerBack,
  saveInFlightRef,
  selectCreatedCategory,
  updateProduct,
  updateStatus,
}: CreateProductEditPersistenceActionsParams) {
  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) {
      return;
    }

    createCategory(newCategoryName, {
      onError: (error) => {
        Alert.alert('Error', error.message);
      },
      onSuccess: (newCategory) => {
        selectCreatedCategory(newCategory.id, newCategory.name);
        resetCategoryForm();
        Alert.alert('Success', 'Category created and selected');
      },
    });
  };

  const handleSave = async () => {
    if (saveInFlightRef.current) {
      return;
    }
    if (!formData.name.trim()) {
      Alert.alert('Validation Error', 'Product name is required');
      return;
    }
    if (
      formData.price === undefined ||
      formData.price === null ||
      formData.price < 0
    ) {
      Alert.alert('Validation Error', 'Please enter a valid price');
      return;
    }
    if (!formData.has_variants) {
      const attributeKeys = formData.variant_attributes
        .map((attribute) => attribute.key.trim().toLowerCase())
        .filter(Boolean);
      if (new Set(attributeKeys).size < attributeKeys.length) {
        Alert.alert(
          'Duplicate Attributes',
          'Each attribute key must be unique. Please remove or rename duplicate keys.'
        );
        return;
      }
    }
    if (
      formData.has_variants &&
      hasVariantConditionAxis &&
      formData.variants.some(
        (variant) =>
          typeof variant.condition !== 'string' ||
          variant.condition.trim() === ''
      )
    ) {
      Alert.alert(
        'Validation Error',
        'Every variant row needs a condition when condition-based pricing is enabled.'
      );
      return;
    }
    if (!isEditing && exactProductSuggestion) {
      Alert.alert(
        'Existing product found',
        `"${exactProductSuggestion.name}" already exists. Open it instead of creating a duplicate product.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open product',
            onPress: () => openProduct(exactProductSuggestion.id),
          },
        ]
      );
      return;
    }
    if (!isEditing && productCreationGate?.requiresUpgrade) {
      Alert.alert(
        'Baci Pro',
        `Free stores can create up to ${productCreationGate.limit.toLocaleString()} products. Upgrade to Baci Pro to add more.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade', onPress: productCreationGate.onUpgrade },
        ]
      );
      return;
    }

    const optionGapWarning = formData.has_variants
      ? describeVariantOptionGaps(formData.variants)
      : null;
    if (optionGapWarning) {
      Alert.alert('Missing variant options', optionGapWarning, [
        { text: 'Go back and fix', style: 'cancel' },
        {
          text: 'Save anyway',
          onPress: () => {
            void persistProduct();
          },
        },
      ]);
      return;
    }

    await persistProduct();
  };

  const persistProduct = async () => {
    try {
      await runSingleFlight(saveInFlightRef, async () => {
        if (isEditing && id) {
          await updateProduct({ id, updates: { ...formData } });
          Alert.alert('Success', 'Product updated successfully');
          routerBack();
          return;
        }

        await createProduct({ ...formData });
        Alert.alert('Success', 'Product created successfully');
        routerBack();
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        Alert.alert(
          'Validation Error',
          error.issues[0]?.message || 'Invalid product data'
        );
        return;
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : typeof error === 'string' && error
            ? error
            : 'Failed to save product';
      Alert.alert('Error', message);
    }
  };

  const handleStatusToggle = (value: boolean) => {
    const nextStatus: 'active' | 'draft' = value ? 'active' : 'draft';
    const previousStatus = formData.status;
    revertStatus(nextStatus);

    if (!isEditing || !id) {
      return;
    }

    updateStatus(
      { productId: id, status: nextStatus },
      {
        onError: (error) => {
          revertStatus(previousStatus);
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to update product status';
          Alert.alert('Update Failed', message);
        },
      }
    );
  };

  return {
    handleCreateCategory,
    handleSave,
    handleStatusToggle,
  };
}
