import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { orderSuccessStyles as styles } from './order-success.styles';

export interface OrderSuccessNextStepsProps {
  colors: typeof Colors.light;
  nextDocumentTitle: string;
  nextDocumentText: string;
}

export function OrderSuccessNextSteps({
  colors,
  nextDocumentTitle,
  nextDocumentText,
}: OrderSuccessNextStepsProps) {
  return (
    <View style={styles.nextSteps}>
      <Text style={[styles.nextTitle, { color: colors.text }]}>
        What happens next
      </Text>
      <View
        style={[
          styles.nextStepCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.stepIconWrap}>
          <Ionicons name="receipt-outline" size={18} color={BRAND.primary} />
        </View>
        <View style={styles.nextStepBody}>
          <Text style={[styles.nextStepTitle, { color: colors.text }]}>
            {nextDocumentTitle}
          </Text>
          <Text style={[styles.nextStepText, { color: colors.textSecondary }]}>
            {nextDocumentText}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.nextStepCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.stepIconWrap}>
          <Ionicons name="cube-outline" size={18} color={BRAND.primary} />
        </View>
        <View style={styles.nextStepBody}>
          <Text style={[styles.nextStepTitle, { color: colors.text }]}>
            Processing & delivery
          </Text>
          <Text style={[styles.nextStepText, { color: colors.textSecondary }]}>
            Your order will be prepared and you can track it in real time.
          </Text>
        </View>
      </View>
    </View>
  );
}
