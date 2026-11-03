import Ionicons from '@react-native-vector-icons/ionicons';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ScrollViewInstance, ViewInstance } from 'react-native';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import {
  bnplEligibilityHint,
  isIntentSelected,
  PAYMENT_INTENTS,
  type PaymentIntent,
} from './payment-intents';
import { paymentIntentAccordionStyles as styles } from './styles';
import type { PaymentMethodType, PaymentTab } from './types';
import { useIntentScrollIntoView } from './use-intent-scroll-into-view';

type ThemeColors = (typeof Colors)['light'];

interface PaymentIntentAccordionProps {
  colors: ThemeColors;
  selectedTab: PaymentTab | null;
  selectedMethod: PaymentMethodType | null;
  hasBNPLMethods: boolean;
  hasPayLaterMethods: boolean;
  availableMethodIds?: readonly PaymentMethodType[];
  isBNPLEligible: boolean;
  orderTotal: number;
  onSelectIntent: (intent: PaymentIntent) => void;
  /** Instrument rows for the expanded instrument-bearing (full/installments) intent. */
  nestedRows: ReactNode;
  /** Contextual info for the selected method (BNPL note, downpayment, etc.). */
  selectedInfo?: ReactNode;
  /** Scrolling ancestor + live offset so the selected card can stay in view. */
  scrollRef?: RefObject<ScrollViewInstance | null>;
  scrollOffsetRef?: RefObject<number>;
  /** Open with every card collapsed (all options visible at a glance) instead
   * of auto-expanding the selected one. */
  initiallyCollapsed?: boolean;
}

/** Which intents to surface, given the merchant's enabled methods. */
function visibleIntents(
  hasBNPLMethods: boolean,
  hasPayLaterMethods: boolean,
  availableMethodIds?: readonly PaymentMethodType[]
): PaymentIntent[] {
  return PAYMENT_INTENTS.filter((intent) => {
    if (intent.tab === 'installments') return hasBNPLMethods;
    if (intent.method) {
      const methodEnabled = availableMethodIds?.includes(intent.method) ?? true;
      return hasPayLaterMethods && methodEnabled;
    }
    return true; // `full` is always available
  });
}

export function PaymentIntentAccordion({
  colors,
  selectedTab,
  selectedMethod,
  hasBNPLMethods,
  hasPayLaterMethods,
  availableMethodIds,
  isBNPLEligible,
  orderTotal,
  onSelectIntent,
  nestedRows,
  selectedInfo,
  scrollRef,
  scrollOffsetRef,
  initiallyCollapsed = false,
}: PaymentIntentAccordionProps) {
  const intents = visibleIntents(
    hasBNPLMethods,
    hasPayLaterMethods,
    availableMethodIds
  );

  // Whether the selected instrument-bearing card is collapsed (options hidden).
  // With `initiallyCollapsed` the accordion opens fully closed so all options
  // are visible at a glance; tapping a card opens it. Selecting a *different*
  // intent opens it (see onPress); tapping the open one toggles it shut.
  const [collapsedSelected, setCollapsedSelected] =
    useState(initiallyCollapsed);

  // `initiallyCollapsed` can flip true → false when wallet/savings credit loads
  // after mount; reopen the selected card so those rows become visible. Runs
  // only when the prop changes, so manual collapses are still respected.
  useEffect(() => {
    if (!initiallyCollapsed) {
      setCollapsedSelected(false);
    }
  }, [initiallyCollapsed]);

  // Ref follows whichever intent is currently selected; the hook scrolls it back
  // into view after a selection collapses a taller sibling above it.
  const selectedCardRef = useRef<ViewInstance>(null);
  useIntentScrollIntoView({
    expandedKey: `${selectedTab}:${selectedMethod}`,
    cardRef: selectedCardRef,
    scrollRef,
    scrollOffsetRef,
  });

  return (
    <View
      style={styles.intentGroup}
      accessibilityRole="radiogroup"
      accessibilityLabel="How would you like to pay?"
    >
      {intents.map((intent) => {
        const instrumentBearing = intent.method === undefined;
        const disabled = intent.id === 'installments' && !isBNPLEligible;
        // `selected` reflects the actual (tab, method) selection independent of
        // eligibility, so a card the user already picked keeps its checked state
        // if the total briefly drifts out of the BNPL band, instead of flashing
        // to "nothing selected". `disabled` still blocks the press handler
        // (line below) and keeps the body collapsed.
        const selected = isIntentSelected(intent, selectedTab, selectedMethod);
        // The card's body (options + info) shows when it is selected and still
        // eligible — and, for collapsible instrument-bearing cards, not
        // manually collapsed.
        const open =
          selected && !disabled && (!instrumentBearing || !collapsedSelected);
        const subtitle = disabled
          ? bnplEligibilityHint(orderTotal)
          : intent.subtitle;

        return (
          <View
            key={intent.id}
            ref={selected ? selectedCardRef : null}
            style={[
              styles.intentCard,
              {
                backgroundColor: colors.card,
                borderColor: selected ? BRAND.primary : colors.border,
                opacity: disabled ? 0.55 : 1,
              },
            ]}
          >
            <Pressable
              style={styles.intentHeader}
              onPress={() => {
                if (disabled) return;
                if (selected) {
                  // Collapsible cards toggle open/closed; the selection stays.
                  // Terminal (radio) cards are already picked — nothing to do.
                  if (instrumentBearing) {
                    setCollapsedSelected((prev) => !prev);
                  }
                  return;
                }
                // Selecting a different intent opens it.
                onSelectIntent(intent);
                setCollapsedSelected(false);
              }}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{
                checked: selected,
                disabled,
                expanded: open,
              }}
              accessibilityLabel={`${intent.label}. ${subtitle}`}
            >
              <View
                style={[
                  styles.intentIcon,
                  { backgroundColor: `${colors.textSecondary}10` },
                ]}
              >
                <Ionicons
                  name={intent.icon}
                  size={22}
                  color={selected ? colors.text : colors.textSecondary}
                />
              </View>

              <View style={styles.intentInfo}>
                <Text style={[styles.intentLabel, { color: colors.text }]}>
                  {intent.label}
                </Text>
                <Text
                  style={[
                    styles.intentSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {subtitle}
                </Text>
              </View>

              {instrumentBearing ? (
                // Expandable intents get a chevron (not a dot) — the real
                // selection dot lives on the instrument row they reveal, so we
                // never stack two dots.
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                  style={styles.intentChevron}
                />
              ) : (
                <View
                  style={[
                    styles.intentRadioOuter,
                    { borderColor: selected ? BRAND.primary : colors.border },
                  ]}
                >
                  {selected ? (
                    <View
                      style={[
                        styles.intentRadioInner,
                        { backgroundColor: BRAND.primary },
                      ]}
                    />
                  ) : null}
                </View>
              )}
            </Pressable>

            {open ? (
              <View
                style={[styles.intentNested, { borderTopColor: colors.border }]}
              >
                {instrumentBearing ? (
                  <View
                    style={styles.intentInstrumentGroup}
                    accessibilityRole="radiogroup"
                    accessibilityLabel={`${intent.label} options`}
                  >
                    {nestedRows}
                  </View>
                ) : null}
                {selectedInfo}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
