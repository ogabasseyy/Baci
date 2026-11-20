import type { Order } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { ModalSafeArea } from '@/components/ui/ModalSafeArea';
import { OrderReportDateMenu } from '@/components/ui/order-report-modal/OrderReportDateMenu';
import { OrderReportStatsPanel } from '@/components/ui/order-report-modal/OrderReportStatsPanel';
import styles from '@/components/ui/order-report-modal/orderReportModalStyles';
import { useTheme } from '@/hooks/useTheme';
import { orderExportTools } from '@/utils/export-orders';

interface OrderReportModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: () => Promise<void>;
  orders: Order[];
  dateRangeLabel: string;
  businessName: string;
  logoUrl?: string;
  onDateSelect?: () => void;
  onPresetSelect?: (preset: string) => void;
}

export default function OrderReportModal({
  visible,
  onClose,
  onExport,
  orders,
  dateRangeLabel,
  businessName,
  logoUrl,
  onDateSelect,
  onPresetSelect,
}: OrderReportModalProps) {
  const { colors, shadows } = useTheme();
  // ... existing stats logic ...
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Calculate stats
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce(
    (sum, o) => sum + (Number(o.total) || 0),
    0
  );
  const pendingCount = orders.filter(
    (o) => o.shipping_status === 'pending'
  ).length;
  const completedCount = orders.filter(
    (o) => o.shipping_status === 'delivered'
  ).length;

  const stats = { totalOrders, totalRevenue, pendingCount, completedCount };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await onExport();
      onClose();
    } catch (error) {
      console.error(error);
    }
    setIsExporting(false);
  };

  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      await orderExportTools.exportOrderReportPDF(
        orders,
        dateRangeLabel,
        businessName,
        logoUrl
      );
      onClose();
    } catch (error) {
      console.error(error);
    }
    setIsExportingPDF(false);
  };

  return (
    <Modal
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape']}
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <ModalSafeArea
        backdropColor="rgba(0,0,0,0.5)"
        onBackdropPress={() => {
          setShowDropdown(false);
          onClose();
        }}
        style={styles.overlay}
      >
        <Pressable
          accessible={false}
          style={[
            styles.container,
            { backgroundColor: colors.card, maxHeight: '80%' },
            shadows.lg,
          ]}
          onPress={(e) => {
            if (showDropdown) setShowDropdown(false);
            e.stopPropagation();
          }}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerTitleRow}>
              <View
                style={[
                  styles.iconBadge,
                  { backgroundColor: colors.primaryLight },
                ]}
              >
                <Ionicons
                  name="document-text"
                  size={20}
                  color={colors.primary}
                />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>
                Orders Report
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close report"
              accessibilityHint="Closes the report modal"
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView
            contentContainerStyle={styles.content}
            style={styles.scrollBody}
          >
            <OrderReportDateMenu
              dateRangeLabel={dateRangeLabel}
              showDropdown={Boolean(onDateSelect && showDropdown)}
              {...(onDateSelect
                ? {
                    onCustomRangeSelect: () => {
                      setShowDropdown(false);
                      onDateSelect();
                    },
                    onPresetSelect: (preset: string) => {
                      setShowDropdown(false);
                      onPresetSelect?.(preset);
                    },
                    onToggleDropdown: () =>
                      setShowDropdown((current) => !current),
                  }
                : {})}
            />

            <OrderReportStatsPanel stats={stats} />
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {/* CSV Button (Secondary) */}
            <Pressable
              style={[
                styles.button,
                { borderColor: colors.border, borderWidth: 1, marginRight: 8 },
              ]}
              onPress={handleExport}
              disabled={isExporting || isExportingPDF}
              accessibilityRole="button"
              accessibilityLabel="Export as CSV"
              accessibilityState={{
                disabled: isExporting || isExportingPDF,
                busy: isExporting,
              }}
            >
              {isExporting ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  CSV
                </Text>
              )}
            </Pressable>

            {/* PDF Button (Primary) */}
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity: isExporting || isExportingPDF ? 0.7 : 1,
                  flex: 2,
                },
              ]}
              onPress={handleExportPDF}
              disabled={isExporting || isExportingPDF}
              accessibilityRole="button"
              accessibilityLabel="Download PDF Report"
              accessibilityState={{
                disabled: isExporting || isExportingPDF,
                busy: isExportingPDF,
              }}
            >
              {isExportingPDF ? (
                <ActivityIndicator color={colors.textOnPrimary} size="small" />
              ) : (
                <>
                  <Ionicons
                    name="document-text-outline"
                    size={18}
                    color={colors.textOnPrimary}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={[styles.buttonText, { color: colors.textOnPrimary }]}
                  >
                    Download PDF Report
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </Pressable>
      </ModalSafeArea>
    </Modal>
  );
}
