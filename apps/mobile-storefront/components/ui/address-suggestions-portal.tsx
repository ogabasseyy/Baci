import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewInstance,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';
import { addressAutocompleteStyles as styles } from './AddressAutocomplete.styles';
import type { PlacePrediction } from './AddressAutocomplete.types';
import { AddressPredictionRow } from './AddressPredictionRow';
import {
  addressSuggestionsPosition,
  type SuggestionsRect,
} from './address-suggestions-position';
import { useAddressSuggestionsSpace } from './use-address-suggestions-space';

type ColorsScheme = (typeof Colors)['light'];

/** Window-coordinate rect of the input the dropdown anchors under. */
export interface AddressAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AddressSuggestionsState {
  anchor: AddressAnchorRect;
  colors: ColorsScheme;
  isDark: boolean;
  onSelect: (prediction: PlacePrediction) => void;
  predictions: PlacePrediction[];
}

interface AddressSuggestionsContextValue {
  show: (state: AddressSuggestionsState) => void;
  hide: () => void;
}

// External store so the dropdown's frequent anchor updates (it tracks the
// field while the form scrolls) rerender ONLY the host layer, never the
// provider's children (the whole checkout screen).
interface SuggestionsStore {
  getSnapshot: () => AddressSuggestionsState | null;
  set: (state: AddressSuggestionsState | null) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSuggestionsStore(): SuggestionsStore {
  let state: AddressSuggestionsState | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    set: (next) => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const AddressSuggestionsContext =
  createContext<AddressSuggestionsContextValue | null>(null);

export function useAddressSuggestionsPortal(): AddressSuggestionsContextValue {
  const context = useContext(AddressSuggestionsContext);
  if (!context) {
    throw new Error(
      'useAddressSuggestionsPortal requires an AddressSuggestionsProvider above the field (see CheckoutScreenView).'
    );
  }
  return context;
}

/**
 * Root-level portal for address suggestions. The dropdown LOOKS attached to
 * the input but renders in this screen-root layer — outside every ScrollView —
 * so the form's scroll gestures, keyboard-dismiss-on-drag, Android
 * parent-bounds hit-testing, and sibling z-order can never break it. Same
 * architecture as react-native-autocomplete-dropdown v5.
 */
export function AddressSuggestionsProvider({
  children,
  onRequestSpace,
}: {
  children: ReactNode;
  onRequestSpace?: (amount: number) => void;
}) {
  const storeRef = useRef<SuggestionsStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSuggestionsStore();
  }
  const store = storeRef.current;

  const value = {
    show: (next: AddressSuggestionsState) => store.set(next),
    hide: () => store.set(null),
  };

  return (
    <AddressSuggestionsContext.Provider value={value}>
      {children}
      <AddressSuggestionsHost store={store} onRequestSpace={onRequestSpace} />
    </AddressSuggestionsContext.Provider>
  );
}

function AddressSuggestionsHost({
  store,
  onRequestSpace,
}: {
  store: SuggestionsStore;
  onRequestSpace?: (amount: number) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { keyboardTop } = useKeyboard();
  const [measurement, setMeasurement] = useState<{
    resultsKey: string;
    height: number;
  } | null>(null);

  const layer = useRef<ViewInstance>(null);
  const [host, setHost] = useState<SuggestionsRect>(() => ({
    x: 0,
    y: 0,
    ...Dimensions.get('window'),
  }));
  const position = state?.predictions.length
    ? addressSuggestionsPosition(state.anchor, host, keyboardTop)
    : null;
  const measureHost = () =>
    layer.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0)
        setHost((previous) =>
          previous.x === x &&
          previous.y === y &&
          previous.width === width &&
          previous.height === height
            ? previous
            : { x, y, width, height }
        );
    });
  const { colors, isDark, onSelect, predictions } = state ?? {};
  // A replacement list can measure to the same height, so remount its
  // ScrollView to get a measurement even when the native size is unchanged.
  const resultsKey = predictions
    ? JSON.stringify(
        predictions.map(({ placeId, mainText, secondaryText }) => [
          placeId,
          mainText,
          secondaryText,
        ])
      )
    : '';
  const contentHeight =
    measurement?.resultsKey === resultsKey ? measurement.height : 0;
  useAddressSuggestionsSpace({
    predictions,
    anchor: state?.anchor,
    host,
    keyboardTop,
    contentHeight,
    onRequestSpace,
  });

  return (
    <View
      ref={layer}
      testID="address-suggestions-layer"
      collapsable={false}
      onLayout={measureHost}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}
    >
      {position && colors && predictions && onSelect ? (
        <View
          style={[
            styles.floatingDropdown,
            {
              backgroundColor: colors.card,
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
              ...position,
            },
          ]}
          accessibilityLabel="Address suggestions"
          accessibilityRole="list"
        >
          <ScrollView
            key={resultsKey}
            onContentSizeChange={(_width, height) =>
              setMeasurement({ resultsKey, height })
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {predictions.map((item) => (
              <AddressPredictionRow
                colors={colors}
                isDark={Boolean(isDark)}
                key={item.placeId}
                onSelect={onSelect}
                prediction={item}
              />
            ))}
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.04)'
                    : colors.muted,
                },
              ]}
            >
              <Text
                style={[styles.footerText, { color: colors.textSecondary }]}
              >
                Powered by{' '}
              </Text>
              <Text style={[styles.footerText, { color: '#4285F4' }]}>G</Text>
              <Text style={[styles.footerText, { color: '#EA4335' }]}>o</Text>
              <Text style={[styles.footerText, { color: '#FBBC05' }]}>o</Text>
              <Text style={[styles.footerText, { color: '#4285F4' }]}>g</Text>
              <Text style={[styles.footerText, { color: '#34A853' }]}>l</Text>
              <Text style={[styles.footerText, { color: '#EA4335' }]}>e</Text>
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
