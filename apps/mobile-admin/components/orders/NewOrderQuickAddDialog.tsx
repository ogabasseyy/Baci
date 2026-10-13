import { useRef } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { AppDialogModal } from '@/components/ui/AppDialogModal';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { formatPriceInput, parseDecimalInput } from './new-order.shared';
import { styles } from './new-order.styles';

interface NewOrderQuickAddDialogProps {
  controller: ReturnType<typeof useNewOrderController>;
}

export function NewOrderQuickAddDialog({
  controller,
}: NewOrderQuickAddDialogProps) {
  const {
    colors,
    customItem,
    formatPrice,
    handleContinueAsCustomItem,
    handleUseQuickAddProductMatch,
    isLoadingQuickAddProductMatches,
    merchant,
    quickAddProductMatches,
    setCustomItem,
    setShowCustomItemModal,
    showCustomItemModal,
  } = controller;

  const priceInputRef = useRef<TextInput>(null);
  const merchantCurrency =
    merchant?.payout_currency?.trim().toUpperCase() || 'NGN';

  return (
    <AppDialogModal
      contentContainerStyle={styles.modalKeyboardCenterContent}
      keyboardAware
      onClose={() => setShowCustomItemModal(false)}
      visible={showCustomItemModal}
    >
      <View style={[styles.dialog, { backgroundColor: colors.card }]}>
        <Text style={[styles.dialogTitle, { color: colors.text }]}>
          Quick Add Item
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            fontStyle: 'italic',
            marginBottom: 16,
          }}
        >
          This item will not be saved to your product inventory.
        </Text>
        <TextInput
          onChangeText={(text) =>
            setCustomItem((previous) => ({ ...previous, name: text }))
          }
          onSubmitEditing={() => priceInputRef.current?.focus()}
          multiline
          placeholder="Item Name (e.g. Red Cake, Delivery)"
          placeholderTextColor={colors.textMuted}
          returnKeyType="next"
          scrollEnabled={false}
          submitBehavior="submit"
          style={[
            styles.dialogInput,
            styles.quickAddNameInput,
            { backgroundColor: colors.inputBg, color: colors.text },
          ]}
          textAlignVertical="top"
          value={customItem.name}
        />
        <View
          style={[
            styles.quickAddAmountRow,
            { backgroundColor: colors.inputBg },
          ]}
        >
          <Text
            accessibilityLabel={`Store currency ${merchantCurrency}`}
            style={[
              styles.quickAddAmountCurrency,
              {
                borderRightColor: colors.border,
                color: colors.textSecondary,
              },
            ]}
          >
            {merchantCurrency}
          </Text>
          <TextInput
            ref={priceInputRef}
            keyboardType="numeric"
            onChangeText={(text) => {
              setCustomItem((previous) => ({
                ...previous,
                price: parseDecimalInput(text),
              }));
            }}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="Amount (0.00)"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            style={[styles.quickAddAmountInput, { color: colors.text }]}
            value={formatPriceInput(customItem.price)}
          />
        </View>
        {quickAddProductMatches.length > 0 ? (
          <View style={styles.quickAddMatches}>
            <Text
              style={[styles.sectionEyebrow, { color: colors.textSecondary }]}
            >
              This item may already exist
            </Text>
            {quickAddProductMatches.map((match) => (
              <Pressable
                accessibilityLabel={`Use existing product ${match.name}`}
                accessibilityRole="button"
                key={match.id}
                onPress={() => handleUseQuickAddProductMatch(match)}
                style={[
                  styles.quickAddMatchRow,
                  { borderColor: colors.border },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>
                    {match.name}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                    {match.matchReason.replace(/-/g, ' ')}
                  </Text>
                </View>
                <Text style={{ color: colors.text }}>
                  {formatPrice(match.price)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {isLoadingQuickAddProductMatches ? (
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            Checking product catalog…
          </Text>
        ) : null}
        <View style={styles.dialogActions}>
          <Pressable
            accessibilityHint="Close this dialog without adding a custom item"
            accessibilityLabel="Cancel"
            accessibilityRole="button"
            onPress={() => setShowCustomItemModal(false)}
            style={styles.dialogBtn}
          >
            <Text style={{ color: colors.textSecondary }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityHint="Add this custom item to the order"
            accessibilityLabel={
              quickAddProductMatches.length > 0
                ? 'Continue as Custom'
                : 'Add to Cart'
            }
            accessibilityRole="button"
            onPress={handleContinueAsCustomItem}
            style={[
              styles.dialogBtn,
              { backgroundColor: colors.success, borderRadius: 8 },
            ]}
          >
            <Text style={{ color: colors.textOnPrimary, fontWeight: 'bold' }}>
              {quickAddProductMatches.length > 0
                ? 'Continue as Custom'
                : 'Add to Cart'}
            </Text>
          </Pressable>
        </View>
      </View>
    </AppDialogModal>
  );
}
