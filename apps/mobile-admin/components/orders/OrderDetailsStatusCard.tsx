import { SHIPPING_STATUS_CONFIG, type ShippingStatus } from '@baci/shared';
import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Fragment } from 'react';
import { Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { getTranslucentColor } from '@/lib/colors/sanitize-css-color';
import { normalizeOrderDetailsShippingStatus } from './order-details.helpers';
import type { OrderSourceInfo } from './order-details.types';
import { orderDetailsOverviewStyles as styles } from './order-details-overview.styles';

interface OrderDetailsStatusCardProps {
  colors: ThemeColors;
  placedOnLabel: string;
  recordedByName?: string | null;
  shippingColor: string;
  shippingConfig: { icon: string; label: string };
  shippingStatus: string;
  source?: string | null;
  sourceInfo: OrderSourceInfo;
  updatedAtLabel: string;
}

export function OrderDetailsStatusCard({
  colors,
  placedOnLabel,
  recordedByName,
  shippingColor,
  shippingConfig,
  shippingStatus,
  source,
  sourceInfo,
  updatedAtLabel,
}: OrderDetailsStatusCardProps) {
  const baseSteps = ['pending', 'processing', 'shipped', 'delivered'];
  const currentStatus = normalizeOrderDetailsShippingStatus(shippingStatus);
  const steps = [...baseSteps];
  if (currentStatus === 'returned' || currentStatus === 'cancelled') {
    // Replace the terminal 'delivered' step so the final step reflects the
    // actual terminal state and 'delivered' is not rendered as active.
    steps[steps.length - 1] = currentStatus;
  }
  const resolvedStepIndex = steps.indexOf(currentStatus);
  // Unknown/unmapped status values default to the first step so the UI never
  // renders in an inconsistent "nothing active" state.
  const currentStepIndex = resolvedStepIndex === -1 ? 0 : resolvedStepIndex;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.statusHeader}>
        <View>
          <Text style={[styles.orderDate, { color: colors.textSecondary }]}>
            Placed on {placedOnLabel}
          </Text>
          <View style={styles.sourceRow}>
            <Ionicons
              color={sourceInfo.color}
              name={sourceInfo.name as IoniconsIconName}
              size={14}
            />
            <Text style={[styles.sourceText, { color: colors.textSecondary }]}>
              {source === 'staff_entry' && recordedByName
                ? `Recorded by ${recordedByName}`
                : `via ${sourceInfo.label}`}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.statusBadgeBig,
            {
              backgroundColor: getTranslucentColor(
                shippingColor,
                colors.backgroundLight,
                0.08
              ),
            },
          ]}
        >
          <Ionicons
            color={shippingColor}
            name={shippingConfig.icon as IoniconsIconName}
            size={14}
          />
          <Text style={[styles.statusTextBig, { color: shippingColor }]}>
            {shippingConfig.label}
          </Text>
        </View>
      </View>

      <View style={styles.progressContainer}>
        {steps.map((step, index) => {
          // For returned/cancelled orders, all steps up to and including the
          // terminal step are active. `currentStepIndex` already points to the
          // 'returned'/'cancelled' entry (which replaced 'delivered'), so a
          // simple `index <= currentStepIndex` is correct for every status.
          const isActive = index <= currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isLast = index === steps.length - 1;
          const stepConfig =
            SHIPPING_STATUS_CONFIG[step as ShippingStatus] ??
            SHIPPING_STATUS_CONFIG.pending;
          const stepColor =
            colors[stepConfig.colorKey as keyof ThemeColors] ?? shippingColor;

          return (
            <Fragment key={step}>
              <View style={styles.progressStep}>
                <View
                  style={[
                    styles.progressDot,
                    {
                      backgroundColor: isActive ? stepColor : colors.inputBg,
                      borderColor: isActive ? stepColor : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    color={isActive ? colors.textOnPrimary : colors.textMuted}
                    name={stepConfig.icon as IoniconsIconName}
                    size={12}
                  />
                </View>
                <Text
                  style={[
                    styles.progressLabel,
                    {
                      color: isCurrent ? colors.text : colors.textMuted,
                      fontWeight: isCurrent ? '700' : '600',
                    },
                  ]}
                >
                  {stepConfig.label}
                </Text>
              </View>
              {!isLast ? (
                <View
                  style={[
                    styles.progressLine,
                    {
                      backgroundColor:
                        index < currentStepIndex ? stepColor : colors.border,
                    },
                  ]}
                />
              ) : null}
            </Fragment>
          );
        })}
      </View>

      <Text style={[styles.statusNote, { color: colors.textMuted }]}>
        Latest update: {updatedAtLabel}
      </Text>
    </View>
  );
}
