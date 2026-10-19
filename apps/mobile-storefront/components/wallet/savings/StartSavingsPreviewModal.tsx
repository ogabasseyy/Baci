import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { BRAND } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { formatSavingsDuration } from './format-savings-duration';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type StartSavingsModalsProps = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
  fundingContent?: ReactNode;
};

export function StartSavingsPreviewModal({
  colors,
  controller,
  fundingContent,
}: StartSavingsModalsProps) {
  return (
    <ModalSheet
      visible={controller.showPreviewModal || controller.showFundingModal}
      animationType="slide"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      {controller.showFundingModal ? (
        fundingContent
      ) : (
        <SavingsReviewContent colors={colors} controller={controller} />
      )}
    </ModalSheet>
  );
}

function SavingsReviewContent({ colors, controller }: StartSavingsModalsProps) {
  const duration = formatSavingsDuration(
    controller.targetValue,
    controller.contributionValue,
    controller.frequency
  );
  const contribution = `${formatNgnCurrency(controller.contributionValue)} / ${controller.frequency}`;

  return (
    <>
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Your savings plan
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Take a moment to check your plan before choosing how to fund it.
      </Text>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 20,
          padding: 18,
          gap: 12,
        }}
      >
        <Text
          style={{
            color: BRAND.primary,
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 1,
          }}
        >
          YOUR NEXT UPGRADE
        </Text>
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: '700' }}>
          {controller.selectedProduct?.name ?? 'Your device'}
        </Text>
        {controller.selectedProduct?.variantLabel ? (
          <Text style={{ color: colors.textSecondary }}>
            {controller.selectedProduct.variantLabel}
          </Text>
        ) : null}
        <Text style={{ color: colors.textSecondary }}>Plan target</Text>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700' }}>
          {formatNgnCurrency(controller.targetValue)}
        </Text>
        <View
          style={{
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingTop: 12,
            gap: 8,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Text style={{ color: colors.textSecondary }}>Save</Text>
            <Text
              style={{
                color: colors.text,
                fontWeight: '600',
                textAlign: 'right',
                flexShrink: 1,
              }}
            >
              {contribution}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Text style={{ color: colors.textSecondary }}>Estimated time</Text>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {duration}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Text style={{ color: colors.textSecondary }}>Target date</Text>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {formatDateTimeDisplay(controller.maturityDate, 'date')}
            </Text>
          </View>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary }}>
        {controller.sourceMode === 'auto_debit'
          ? 'Automatic card contributions'
          : 'Manual contributions'}{' '}
        · First contribution{' '}
        {formatNgnCurrency(
          controller.sourceMode === 'auto_debit'
            ? 0
            : controller.effectiveInitialContribution
        )}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose savings funding option"
        style={styles.primaryButton}
        onPress={() => {
          controller.setShowPreviewModal(false);
          controller.setShowFundingModal(true);
        }}
      >
        <Text style={styles.primaryButtonText}>Next: choose how to fund</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close preview"
        style={styles.modalCloseButton}
        onPress={() => controller.setShowPreviewModal(false)}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Edit plan
        </Text>
      </Pressable>
    </>
  );
}
