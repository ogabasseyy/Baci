import { router, Stack } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { SuccessModal } from '@/components/ui/SuccessModal';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { NewOrderChannelSection } from './NewOrderChannelSection';
import { NewOrderCustomerSheet } from './NewOrderCustomerSheet';
import { NewOrderDetailsSection } from './NewOrderDetailsSection';
import { NewOrderEditItemSheet } from './NewOrderEditItemSheet';
import { NewOrderFinancialSheet } from './NewOrderFinancialSheet';
import { NewOrderFooterBar } from './NewOrderFooterBar';
import { NewOrderItemsSection } from './NewOrderItemsSection';
import { NewOrderNotesSection } from './NewOrderNotesSection';
import { NewOrderProductSheet } from './NewOrderProductSheet';
import { NewOrderQuickAddDialog } from './NewOrderQuickAddDialog';
import { styles } from './new-order.styles';

interface NewOrderScreenContentProps {
  controller: ReturnType<typeof useNewOrderController>;
}

export function NewOrderScreenContent({
  controller,
}: NewOrderScreenContentProps) {
  const {
    colors,
    isSubmitting,
    lastOrderId,
    resetOrderDraft,
    setShowSuccessModal,
    showSuccessModal,
  } = controller;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'New Sale',
          headerLeft: () => (
            <Pressable
              accessibilityHint="Discards the current order draft and returns to the previous screen"
              accessibilityLabel="Cancel new order"
              accessibilityRole="button"
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              onPress={() => router.back()}
              style={({ pressed }) => [
                {
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={{ color: colors.text, fontSize: 16 }}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () =>
            isSubmitting ? <ActivityIndicator color={colors.primary} /> : null,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />

      <AppFormScreen
        edges={[]}
        footer={<NewOrderFooterBar controller={controller} />}
        footerStyle={{ backgroundColor: colors.card }}
        scrollEnabled={false}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <NewOrderDetailsSection
            allowOrderAddressEdit
            controller={controller}
          />
          <NewOrderChannelSection controller={controller} />
          <NewOrderItemsSection controller={controller} />
          <NewOrderNotesSection controller={controller} />
          <View style={{ height: 100 }} />
        </ScrollView>
      </AppFormScreen>

      <NewOrderProductSheet controller={controller} />
      <NewOrderQuickAddDialog controller={controller} />
      <NewOrderCustomerSheet controller={controller} />
      <NewOrderFinancialSheet controller={controller} />
      <NewOrderEditItemSheet controller={controller} />

      <SuccessModal
        actionLabel="View Order Details"
        closeLabel="Create New Sale"
        message="The order has been successfully saved to your records."
        onActionPress={() => {
          setShowSuccessModal(false);
          if (lastOrderId) {
            router.replace(`/order/${lastOrderId}`);
            return;
          }
          if (__DEV__) {
            console.warn(
              '[NewOrderScreenContent] Missing lastOrderId after successful order save'
            );
          }
          resetOrderDraft();
        }}
        onClose={() => {
          setShowSuccessModal(false);
          resetOrderDraft();
        }}
        title="Sale Recorded!"
        visible={showSuccessModal}
      />
    </>
  );
}
