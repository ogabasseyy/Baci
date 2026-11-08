import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { DEFAULT_ASSURANCE_PERCENT_LABEL } from '@/constants/assurance';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import styles from './styles';

interface AssuranceToggleProps {
  item: CartItem;
  assuranceCost: number;
  toggleAssurance: (itemId: string) => void;
  formatPrice: (amount: number) => string;
  colors: (typeof Colors)['light'];
}

export default function AssuranceToggle({
  item,
  assuranceCost,
  toggleAssurance,
  formatPrice,
  colors,
}: AssuranceToggleProps) {
  return (
    <Pressable
      style={styles.assuranceContainer}
      onPress={() => toggleAssurance(item.id)}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!item.hasAssurance }}
      accessibilityLabel={`Toggle Ogabassey Assurance for ${item.name}`}
    >
      <View
        style={[
          styles.toggle,
          {
            backgroundColor: item.hasAssurance ? BRAND.primary : colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.toggleKnob,
            item.hasAssurance && styles.toggleKnobActive,
            { backgroundColor: colors.cardForeground },
          ]}
        />
      </View>
      <View style={styles.assuranceInfo}>
        <View style={styles.assuranceHeader}>
          <Ionicons name="shield-checkmark" size={12} color={BRAND.primary} />
          <Text style={[styles.assuranceTitle, { color: colors.text }]}>
            Ogabassey Assurance
          </Text>
        </View>
        <Text style={[styles.assuranceDesc, { color: colors.textSecondary }]}>
          {item.hasAssurance
            ? `Screen & Liquid Damage +${formatPrice(assuranceCost)}`
            : `Device Protection (+${DEFAULT_ASSURANCE_PERCENT_LABEL})`}
        </Text>
        <Text style={[styles.assuranceDesc, { color: colors.textSecondary }]}>
          {item.hasAssurance
            ? 'Optional. Included in total; tap to remove.'
            : 'Optional. Tap to add.'}
        </Text>
      </View>
    </Pressable>
  );
}
