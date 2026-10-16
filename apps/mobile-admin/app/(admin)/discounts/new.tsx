import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Controller,
  type FieldErrors,
  type Resolver,
  useForm,
  useWatch,
} from 'react-hook-form';
import {
  // Switch,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as z from 'zod';
import { DiscountItemSelector } from '@/components/discounts/DiscountItemSelector';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useCurrency } from '@/hooks/useCurrency';
import { useDiscounts } from '@/hooks/useDiscounts';
import { useTheme } from '@/hooks/useTheme';
import type { CreateDiscountDTO } from '@/lib/types/discounts';

const discountSchema = z
  .object({
    code: z.string().min(3, 'Code must be at least 3 characters').toUpperCase(),
    discount_type: z.enum(['percentage', 'fixed_amount']),
    discount_value: z.coerce.number().min(1, 'Value must be greater than 0'),
    minimum_purchase_amount: z.coerce.number().optional(),
    usage_limit: z.coerce.number().optional(),
    usage_limit_per_customer: z.coerce.number().optional(),
    is_active: z.boolean().default(true),
    applies_to: z
      .enum(['all', 'specific_products', 'specific_categories'])
      .default('all'),
    product_ids: z.array(z.string()).optional(),
    category_ids: z.array(z.string()).optional(),
    starts_at: z.date().optional(),
    expires_at: z.date().optional(),
  })
  .refine(
    (data) => {
      if (data.discount_type === 'percentage' && data.discount_value > 100) {
        return false;
      }
      return true;
    },
    {
      message: 'Percentage discount cannot exceed 100%',
      path: ['discount_value'],
    }
  );

type DiscountFormInput = z.input<typeof discountSchema>;
type DiscountFormOutput = z.output<typeof discountSchema>;
const discountResolver: Resolver<
  DiscountFormInput,
  undefined,
  DiscountFormOutput
> = (values) => {
  const result = discountSchema.safeParse(values);

  if (result.success) {
    return {
      values: result.data,
      errors: {},
    };
  }

  const { fieldErrors } = result.error.flatten();
  const errors = Object.entries(fieldErrors).reduce(
    (accumulator, entry) => {
      const [fieldName, messages] = entry;
      const message = messages?.[0];

      if (!message) {
        return accumulator;
      }

      accumulator[fieldName as keyof DiscountFormInput] = {
        type: 'manual',
        message,
      };

      return accumulator;
    },
    {} as FieldErrors<DiscountFormInput>
  );

  return {
    values: {} as never,
    errors,
  };
};

function formatDate(date?: Date): string {
  return date ? date.toLocaleDateString() : 'Set Date';
}

export default function NewDiscountScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { createDiscount, isCreating } = useDiscounts();
  const { symbol } = useCurrency();
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [showCategorySelector, setShowCategorySelector] = useState(false);
  const [showStartDate, setShowStartDate] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DiscountFormInput, undefined, DiscountFormOutput>({
    resolver: discountResolver,
    defaultValues: {
      code: '',
      discount_type: 'percentage',
      discount_value: 0,
      is_active: true,
      applies_to: 'all',
      product_ids: [],
      category_ids: [],
      starts_at: new Date(),
    },
  });

  const discountType = useWatch({ control, name: 'discount_type' });
  const appliesTo = useWatch({ control, name: 'applies_to' });
  const productIds = useWatch({ control, name: 'product_ids' }) || [];
  const categoryIds = useWatch({ control, name: 'category_ids' }) || [];
  const startsAt = useWatch({ control, name: 'starts_at' });
  const expiresAt = useWatch({ control, name: 'expires_at' });

  const onSubmit = async (data: DiscountFormOutput) => {
    try {
      await createDiscount({
        ...data,
        starts_at: data.starts_at?.toISOString(),
        expires_at: data.expires_at?.toISOString(),
      } as CreateDiscountDTO);
      Alert.alert('Success', 'Discount code created successfully', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: unknown) {
      console.error(error);
      Alert.alert('Error', 'Failed to create discount code');
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Create Discount',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Code */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              General Information
            </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                Discount Code
              </Text>
              <Controller
                control={control}
                name="code"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: errors.code ? colors.error : colors.border,
                      },
                    ]}
                    placeholder="e.g. SUMMER2024"
                    placeholderTextColor={colors.textMuted}
                    onBlur={onBlur}
                    onChangeText={(text) => onChange(text.toUpperCase())}
                    value={value}
                    autoCapitalize="characters"
                  />
                )}
              />
              {errors.code && (
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {errors.code.message}
                </Text>
              )}
            </View>

            {/* Type Segment */}
            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                Discount Type
              </Text>
              <View
                style={[
                  styles.segmentContainer,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {(['percentage', 'fixed_amount'] as const).map((type) => (
                  <Pressable
                    key={type}
                    style={[
                      styles.segmentButton,
                      discountType === type && {
                        backgroundColor: colors.primary,
                      },
                    ]}
                    onPress={() => setValue('discount_type', type)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color:
                            discountType === type
                              ? colors.textOnPrimary
                              : colors.text,
                        },
                      ]}
                    >
                      {type === 'percentage'
                        ? 'Percentage (%)'
                        : `Fixed Amount (${symbol})`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Value Input */}
            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {discountType === 'percentage'
                  ? 'Percentage Value (%)'
                  : `Discount Amount (${symbol})`}
              </Text>
              <Controller
                control={control}
                name="discount_value"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: errors.discount_value
                          ? colors.error
                          : colors.border,
                      },
                    ]}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value?.toString()}
                  />
                )}
              />
              {errors.discount_value && (
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {errors.discount_value.message}
                </Text>
              )}
            </View>
          </View>

          {/* Applies To */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Applies To
            </Text>
            <View style={styles.radioGroup}>
              {(
                ['all', 'specific_products', 'specific_categories'] as const
              ).map((type) => (
                <Pressable
                  key={type}
                  style={styles.radioRow}
                  onPress={() => setValue('applies_to', type)}
                >
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor:
                          appliesTo === type
                            ? colors.primary
                            : colors.textMuted,
                      },
                    ]}
                  >
                    {appliesTo === type && (
                      <View
                        style={[
                          styles.radioInner,
                          { backgroundColor: colors.primary },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={[styles.radioLabel, { color: colors.text }]}>
                    {type === 'all'
                      ? 'All Orders'
                      : type === 'specific_products'
                        ? 'Specific Products'
                        : 'Specific Categories'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {appliesTo === 'specific_products' && (
              <View
                style={[
                  styles.selectorContainer,
                  { borderColor: colors.border },
                ]}
              >
                <Text style={[styles.label, { color: colors.text }]}>
                  Selected Products: {productIds.length}
                </Text>
                <Pressable
                  style={[
                    styles.selectorButton,
                    { borderColor: colors.primary },
                  ]}
                  onPress={() => setShowProductSelector(true)}
                >
                  <Text style={{ color: colors.primary }}>Browse Products</Text>
                </Pressable>
              </View>
            )}

            {appliesTo === 'specific_categories' && (
              <View
                style={[
                  styles.selectorContainer,
                  { borderColor: colors.border },
                ]}
              >
                <Text style={[styles.label, { color: colors.text }]}>
                  Selected Categories: {categoryIds.length}
                </Text>
                <Pressable
                  style={[
                    styles.selectorButton,
                    { borderColor: colors.primary },
                  ]}
                  onPress={() => setShowCategorySelector(true)}
                >
                  <Text style={{ color: colors.primary }}>
                    Browse Categories
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Valid Dates */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Active Dates
            </Text>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, marginRight: SPACING.sm }}>
                <Text style={[styles.label, { color: colors.text }]}>
                  Start Date
                </Text>
                <Pressable
                  style={[
                    styles.dateButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setShowStartDate(true)}
                >
                  <Text style={{ color: colors.text }}>
                    {formatDate(startsAt)}
                  </Text>
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={[styles.label, { color: colors.text }]}>
                  End Date (Optional)
                </Text>
                <Pressable
                  style={[
                    styles.dateButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setShowEndDate(true)}
                >
                  <Text style={{ color: colors.text }}>
                    {formatDate(expiresAt)}
                  </Text>
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
            </View>
            {showStartDate && (
              <DateTimePicker
                value={startsAt || new Date()}
                mode="date"
                display="default"
                onChange={(_event, date) => {
                  setShowStartDate(false);
                  if (date) setValue('starts_at', date);
                }}
              />
            )}
            {showEndDate && (
              <DateTimePicker
                value={expiresAt || new Date()}
                mode="date"
                display="default"
                onChange={(_event, date) => {
                  setShowEndDate(false);
                  if (date) setValue('expires_at', date);
                }}
              />
            )}
          </View>

          {/* Requirements &amp; Limits */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Requirements &amp; Limits
            </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                Min. Purchase Amount ({symbol})
              </Text>
              <Controller
                control={control}
                name="minimum_purchase_amount"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: colors.border,
                      },
                    ]}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value?.toString()}
                  />
                )}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                Total Usage Limit
              </Text>
              <Controller
                control={control}
                name="usage_limit"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: colors.border,
                      },
                    ]}
                    placeholder="e.g. 100"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value?.toString()}
                  />
                )}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                Limit Per Customer
              </Text>
              <Controller
                control={control}
                name="usage_limit_per_customer"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.card,
                        color: colors.text,
                        borderColor: colors.border,
                      },
                    ]}
                    placeholder="e.g. 1"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value?.toString()}
                  />
                )}
              />
            </View>
          </View>

          <DiscountItemSelector
            visible={showProductSelector}
            type="product"
            initialIds={productIds}
            onClose={() => setShowProductSelector(false)}
            onSelect={(ids) => setValue('product_ids', ids)}
          />

          <DiscountItemSelector
            visible={showCategorySelector}
            type="category"
            initialIds={categoryIds}
            onClose={() => setShowCategorySelector(false)}
            onSelect={(ids) => setValue('category_ids', ids)}
          />

          <Pressable
            style={[
              styles.submitButton,
              {
                backgroundColor: colors.primary,
                opacity: isCreating ? 0.7 : 1,
              },
            ]}
            onPress={handleSubmit(onSubmit)}
            disabled={isCreating}
          >
            {isCreating ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text
                style={[
                  styles.submitButtonText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Create Discount
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { padding: SPACING.sm, marginLeft: -SPACING.sm },
  content: { padding: SPACING.lg },
  section: { marginBottom: SPACING.xl },
  sectionTitle: {
    fontSize: TYPOGRAPHY.size.lg,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginBottom: SPACING.md,
  },
  formGroup: { marginBottom: SPACING.md },
  label: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginBottom: SPACING.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  errorText: {
    fontSize: TYPOGRAPHY.size.xs,
    color: 'red',
    marginTop: SPACING.xs,
  },
  segmentContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  segmentButton: { flex: 1, paddingVertical: SPACING.sm, alignItems: 'center' },
  segmentText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  radioGroup: { marginBottom: SPACING.md },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    paddingVertical: 4,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  radioLabel: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  selectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.sm,
    borderWidth: 1,

    borderRadius: RADIUS.md,
  },
  selectorButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
  },
  dateButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderWidth: 1,
    borderRadius: RADIUS.md,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  submitButton: {
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  submitButtonText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
});
