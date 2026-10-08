import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { SuccessModal } from '@/components/ui/SuccessModal';
import type { useEditOrderController } from '@/hooks/useEditOrderController';
import { EditOrderFooterBar } from './EditOrderFooterBar';
import { NewOrderChannelSection } from './NewOrderChannelSection';
import { NewOrderCustomerSheet } from './NewOrderCustomerSheet';
import { NewOrderDetailsSection } from './NewOrderDetailsSection';
import { NewOrderEditItemSheet } from './NewOrderEditItemSheet';
import { NewOrderFinancialSheet } from './NewOrderFinancialSheet';
import { NewOrderItemsSection } from './NewOrderItemsSection';
import { NewOrderNotesSection } from './NewOrderNotesSection';
import { NewOrderProductSheet } from './NewOrderProductSheet';
import { NewOrderQuickAddDialog } from './NewOrderQuickAddDialog';
import { styles } from './new-order.styles';

interface EditOrderScreenContentProps {
  controller: ReturnType<typeof useEditOrderController>;
}

export function EditOrderScreenContent({
  controller,
}: EditOrderScreenContentProps) {
  const [footerHeight, setFooterHeight] = useState(150);

  if (controller.isEditLoading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: controller.colors.background,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={controller.colors.primary} size="large" />
      </View>
    );
  }

  if (controller.isEditError || !controller.order) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShadowVisible: false,
            headerShown: true,
            headerStyle: { backgroundColor: controller.colors.background },
            headerTintColor: controller.colors.text,
            headerTitle: 'Edit Order',
          }}
        />
        <View
          style={{
            alignItems: 'center',
            backgroundColor: controller.colors.background,
            flex: 1,
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Text
            style={{
              color: controller.colors.text,
              fontSize: 18,
              fontWeight: '700',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            Unable to load order
          </Text>
          <Text
            style={{
              color: controller.colors.textSecondary,
              fontSize: 14,
              marginBottom: 20,
              textAlign: 'center',
            }}
          >
            Try again from the order details screen.
          </Text>
          <Pressable
            accessibilityLabel="Return to order"
            accessibilityRole="button"
            onPress={() =>
              controller.orderId ? controller.viewOrder() : router.back()
            }
            style={({ pressed }) => [
              {
                backgroundColor: controller.colors.primary,
                borderRadius: 8,
                paddingHorizontal: 18,
                paddingVertical: 12,
              },
              pressed && { opacity: 0.72 },
            ]}
          >
            <Text
              style={{
                color: controller.colors.textOnPrimary,
                fontWeight: '700',
              }}
            >
              Return
            </Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Cancel edit order"
              accessibilityRole="button"
              accessibilityState={{ disabled: controller.isSubmitting }}
              disabled={controller.isSubmitting}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              onPress={controller.viewOrder}
              style={({ pressed }) => [
                { paddingRight: 16 },
                controller.isSubmitting
                  ? { opacity: 0.5 }
                  : pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={{ color: controller.colors.text, fontSize: 16 }}>
                Cancel
              </Text>
            </Pressable>
          ),
          headerRight: () =>
            controller.isSubmitting ? (
              <ActivityIndicator color={controller.colors.primary} />
            ) : null,
          headerShadowVisible: false,
          headerShown: true,
          headerStyle: { backgroundColor: controller.colors.background },
          headerTintColor: controller.colors.text,
          headerTitle: 'Edit Order',
        }}
      />

      <AppFormScreen
        edges={['bottom']}
        footer={
          <EditOrderFooterBar
            controller={controller}
            onLayout={(event) =>
              setFooterHeight(event.nativeEvent.layout.height)
            }
          />
        }
        scrollEnabled={false}
        style={[
          styles.container,
          { backgroundColor: controller.colors.background },
        ]}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: footerHeight + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <NewOrderDetailsSection controller={controller} />
          <NewOrderChannelSection controller={controller} />
          <NewOrderItemsSection controller={controller} />
          <NewOrderNotesSection controller={controller} />
        </ScrollView>
      </AppFormScreen>

      <NewOrderProductSheet controller={controller} />
      <NewOrderQuickAddDialog controller={controller} />
      <NewOrderCustomerSheet controller={controller} />
      <NewOrderFinancialSheet controller={controller} />
      <NewOrderEditItemSheet controller={controller} />

      <SuccessModal
        actionLabel="View Order Details"
        closeLabel="Done"
        message="The order has been updated."
        onActionPress={() => {
          controller.setShowSuccessModal(false);
          controller.viewOrder();
        }}
        onClose={() => {
          controller.setShowSuccessModal(false);
          controller.viewOrder();
        }}
        subMessage={
          controller.notifyCustomer
            ? 'Customer notification will be sent if customer-visible details changed.'
            : undefined
        }
        title="Order Updated"
        visible={controller.showSuccessModal}
      />
    </>
  );
}
