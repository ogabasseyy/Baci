import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type {
  WalletActiveSavingsGoal,
  WalletSavingsVariantResolutionOption,
} from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsSheetLock } from '../SavingsSheetLock';
import type { SavingsVariantResolveResult } from '../savings-variant-resolution.handlers';
import { styles } from './savings-phone-swap.styles';

type WalletColors = (typeof Colors)['light'];

/**
 * A completed goal whose exact phone option was never chosen: pick it here,
 * inside the savings sheet, before the store team can fulfil the order.
 * Problems show inline; nothing is saved until "Confirm this option".
 */
// Choices saved while the wallet could not refresh, by account, store and goal.
// Kept outside the picker so going back and reopening never re-sends the
// one-time choice; the picker stops opening once the wallet shows it resolved.
const savedWithoutRefresh = new Map<string, string>();

type PickProps = {
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  onBack: () => void;
  /** True when saved, `{ saved }` when saved but not refreshed, or a message. */
  onResolve: (variantId: string) => Promise<SavingsVariantResolveResult>;
  options: WalletSavingsVariantResolutionOption[];
};

/** A fresh picker for each account, store and goal: no choice carries over. */
export function SavingsVariantPickStep(props: PickProps) {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId ?? undefined);
  const scopeKey = `${userId}:${merchantId}:${props.goal.id}`;
  return <VariantPick key={scopeKey} scopeKey={scopeKey} {...props} />;
}

function VariantPick({
  colors,
  goal,
  onBack,
  onResolve,
  options,
  scopeKey,
}: PickProps & { scopeKey: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The choice is a one-time assignment: the sheet stays open while it saves.
  useSavingsSheetLock(pending);
  const [error, setError] = useState<string | null>(null);
  // Saved but the wallet didn't refresh: the one-time choice is never sent again.
  const [savedNote, setSavedNote] = useState<string | null>(
    () => savedWithoutRefresh.get(scopeKey) ?? null
  );
  const locked = pending || savedNote !== null;

  // Blocks a second tap before React re-renders with `pending` set.
  const inFlight = useRef(false);
  // A reply that lands after this picker is gone (another goal, account or
  // store) never navigates or shows an error on whatever replaced it.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = async () => {
    if (!chosen || inFlight.current || savedNote) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onResolve(chosen);
      // Recorded even if the picker closed meanwhile: it is saved either way.
      if (typeof result === 'object')
        savedWithoutRefresh.set(scopeKey, result.saved);
      if (!mounted.current) return;
      if (result === true) onBack();
      else if (typeof result === 'string') setError(result);
      else setSavedNote(result.saved);
    } catch {
      if (mounted.current)
        setError("We couldn't save your choice. Please try again.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
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
              accessibilityState={{ checked: selected, disabled: locked }}
              disabled={locked}
              onPress={() => {
                setChosen(option.id);
                setError(null);
              }}
              style={[
                styles.row,
                { borderTopColor: colors.border },
                selected && {
                  backgroundColor: colors.primaryLowOpacity,
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
      {savedNote ? (
        <Text
          accessibilityRole="alert"
          style={[styles.note, { color: colors.textSecondary }]}
        >
          {savedNote}
        </Text>
      ) : null}
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
        accessibilityState={{ disabled: !chosen || locked, busy: pending }}
        disabled={!chosen || locked}
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
