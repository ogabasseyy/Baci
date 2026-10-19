import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type {
  ProductMatchCandidate,
  RankedProductMatch,
} from '@/lib/product-matching';
import { ExistingProductSuggestions } from './ExistingProductSuggestions';

interface CategoryOption {
  id: string;
  name: string;
  slug?: string | null;
}

interface ProductBasicInformationFormData {
  brand: string;
  category: string;
  category_id: string;
  color: string;
  description: string;
  name: string;
  sku: string;
}

interface ProductBasicInformationCardProps {
  categories: CategoryOption[];
  colors: ThemeColors;
  formData: ProductBasicInformationFormData;
  hasVariants?: boolean;
  hideColorField?: boolean;
  isEditing: boolean;
  onChange: (updates: Partial<ProductBasicInformationFormData>) => void;
  onOpenCategoryModal: () => void;
  onOpenProduct: (productId: string) => void;
  productNameSuggestions: RankedProductMatch<ProductMatchCandidate>[];
}

export function ProductBasicInformationCard({
  categories,
  colors,
  formData,
  hasVariants = false,
  hideColorField = false,
  isEditing,
  onChange,
  onOpenCategoryModal,
  onOpenProduct,
  productNameSuggestions,
}: ProductBasicInformationCardProps) {
  const selectedCategoryName =
    categories.find((category) => category.id === formData.category_id)?.name ||
    formData.category ||
    'Select Category';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.cardTitle, { color: colors.text }]}>
        Basic Information
      </Text>

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Product Name <Text style={{ color: colors.error }}>*</Text>
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            color: colors.text,
            borderColor: colors.border,
          },
        ]}
        value={formData.name}
        onChangeText={(name) => onChange({ name })}
        placeholder="Enter product name"
        placeholderTextColor={colors.textSecondary}
      />
      {!isEditing ? (
        <ExistingProductSuggestions
          colors={colors}
          suggestions={productNameSuggestions}
          onOpenProduct={onOpenProduct}
        />
      ) : null}

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {hasVariants ? 'SKU (optional)' : 'SKU'}
        {!hasVariants ? <Text style={{ color: colors.error }}> *</Text> : null}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            color: colors.text,
            borderColor: colors.border,
          },
        ]}
        value={formData.sku}
        onChangeText={(sku) => onChange({ sku })}
        placeholder="Enter SKU"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Category <Text style={{ color: colors.error }}>*</Text>
      </Text>
      <Pressable
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            borderColor: colors.border,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
        ]}
        onPress={onOpenCategoryModal}
        accessibilityRole="button"
        accessibilityLabel="Select category"
      >
        <Text
          style={{
            color: formData.category_id ? colors.text : colors.textSecondary,
          }}
        >
          {selectedCategoryName}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
      </Pressable>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Brand</Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBg,
            color: colors.text,
            borderColor: colors.border,
          },
        ]}
        value={formData.brand}
        onChangeText={(brand) => onChange({ brand })}
        placeholder="e.g. Apple"
        placeholderTextColor={colors.textSecondary}
      />

      {hideColorField ? (
        <View style={styles.noteContainer}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Color
          </Text>
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>
            Variant rows control the selected color for this product.
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Color
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBg,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            value={formData.color}
            onChangeText={(color) => onChange({ color })}
            placeholder="e.g. Midnight Blue"
            placeholderTextColor={colors.textSecondary}
          />
        </>
      )}

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Description
      </Text>
      <TextInput
        style={[
          styles.input,
          styles.textArea,
          {
            backgroundColor: colors.inputBg,
            color: colors.text,
            borderColor: colors.border,
          },
        ]}
        value={formData.description}
        onChangeText={(description) => onChange({ description })}
        placeholder="Enter product description"
        placeholderTextColor={colors.textSecondary}
        multiline
        numberOfLines={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 15,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  noteContainer: {
    gap: 4,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
