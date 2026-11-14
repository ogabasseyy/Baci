import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import { styles } from './WalletPinSettingsScreen.styles';

/** The calm "PIN saved" state shown in place of the form. */
export function WalletPinSavedView({
  colors,
  title,
  onDone,
}: {
  colors: (typeof Colors)['light'];
  title: string;
  onDone: () => void;
}) {
  // One Done only: a quick double tap must not go back twice (past Settings).
  const pressed = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const done = () => {
    if (pressed.current) return;
    pressed.current = true;
    setLeaving(true);
    onDone();
  };
  return (
    <View style={styles.saved}>
      <View
        style={[
          styles.badge,
          { backgroundColor: withAlpha(colors.success, 0.12) },
        ]}
      >
        <Ionicons name="checkmark" size={28} color={colors.success} />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, styles.center, { color: colors.text }]}
      >
        {title}
      </Text>
      <Text
        style={[styles.body, styles.center, { color: colors.textSecondary }]}
      >
        You’ll use it whenever money leaves your wallet.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        accessibilityState={{ disabled: leaving }}
        disabled={leaving}
        onPress={done}
        style={[styles.primary, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
          Done
        </Text>
      </Pressable>
    </View>
  );
}
