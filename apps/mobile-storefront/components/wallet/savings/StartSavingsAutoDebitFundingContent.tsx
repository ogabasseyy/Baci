import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import { handleSavingsModalActionError } from './start-savings-modal-action-error';
import { SavedPaymentMethodCard } from './start-savings-modal-parts';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsAutoDebitFundingContent({
  colors,
  controller,
}: Props) {
  // Nothing here changes while the plan is being created or a card added:
  // a change mid-creation would discard the created plan's result.
  const busy = controller.isSubmitting || controller.isAuthorizingCard;
  return (
    <View style={styles.savedPaymentMethodList}>
      {controller.isLoadingPaymentMethods ? (
        <ActivityIndicator
          accessibilityLabel="Loading savings payment methods"
          size="small"
          color={BRAND.primary}
        />
      ) : controller.savedPaymentMethods.length > 0 ? (
        controller.savedPaymentMethods.map((method) => (
          <SavedPaymentMethodCard
            key={method.id}
            active={controller.selectedPaymentMethodId === method.id}
            colors={colors}
            method={method}
            disabled={busy}
            onPress={() => {
              controller.setSelectedPaymentMethodId(method.id);
              controller.setPaymentMethodsError(null);
            }}
          />
        ))
      ) : (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No saved cards yet.
        </Text>
      )}
      {controller.paymentMethodsError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.paymentMethodsError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add savings card"
        style={[
          styles.outlineButton,
          { borderColor: colors.border },
          busy ? styles.buttonDisabled : null,
        ]}
        onPress={() => {
          controller.handleAuthorizeSavingsCard().catch((error) => {
            handleSavingsModalActionError({
              error,
              message: 'Please try adding your card again.',
              operation: 'Savings card authorization',
              title: 'Unable to add card',
            });
          });
        }}
        disabled={busy}
      >
        <Text style={[styles.outlineButtonText, { color: colors.text }]}>
          {controller.isAuthorizingCard
            ? 'Opening secure checkout…'
            : 'Add card'}
        </Text>
      </Pressable>
    </View>
  );
}
