import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';
import type {
  WalletActiveSavingsGoal,
  WalletSavingsVariantResolutionOption,
} from '@/hooks/wallet-query';
import { useSavingsSheetLock } from '../SavingsSheetLock';
import { styles } from './savings-phone-swap.styles';

type WalletColors = (typeof Colors)['light'];

/**
 * A completed goal whose exact phone option was never chosen: pick it here,
 * inside the savings sheet, before the store team can fulfil the order.
 * Problems show inline; nothing is saved until "Confirm this option".
 */
export function SavingsVariantPickStep({
  colors,
  goal,
  onBack,
  onResolve,
  options,
}: {
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  onBack: () => void;
  /** True when saved, or a message to show when it was not. */
  onResolve: (variantId: string) => Promise<true | string>;
  options: WalletSavingsVariantResolutionOption[];
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The choice is a one-time assignment: the sheet stays open while it saves.
  useSavingsSheetLock(pending);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!chosen || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onResolve(chosen);
      if (result === true) onBack();
      else setError(result);
    } catch {
      setError("We couldn't save your choice. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to savings"
          disabled={pending}
          onPress={onBack}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Ionicons name="options-outline" size={20} color={colors.primary} />
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Choose your exact phone
        </Text>
      </View>
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        {`Pick the ${goal.title} option you want, so our team can get it ready.`}
      </Text>
      {options.length === 0 ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          No options are available right now. Please contact support.
        </Text>
      ) : (
        options.map((option) => {
          const selected = chosen === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled: pending }}
              disabled={pending}
              onPress={() => {
                setChosen(option.id);
                setError(null);
              }}
              style={[
                styles.row,
                { borderTopColor: colors.border },
                selected && {
                  backgroundColor: palette.red[50],
                  borderRadius: 12,
                  paddingHorizontal: 8,
                },
              ]}
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={selected ? colors.primary : colors.textSecondary}
              />
              <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })
      )}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.note, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Confirm this option"
        accessibilityState={{ disabled: !chosen || pending, busy: pending }}
        disabled={!chosen || pending}
        onPress={() => void confirm()}
        style={[
          styles.primary,
          { backgroundColor: chosen ? colors.primary : colors.muted },
        ]}
      >
        {pending ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Text
            style={[
              styles.primaryText,
              {
                color: chosen ? colors.primaryForeground : colors.textSecondary,
              },
            ]}
          >
            Confirm this option
          </Text>
        )}
      </Pressable>
    </View>
  );
}
