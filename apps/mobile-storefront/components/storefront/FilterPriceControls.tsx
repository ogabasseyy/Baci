import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { SheetDoneButton } from '@/components/ui/SheetDoneButton';
import { useTheme } from '@/hooks/useTheme';
import { getFilterBarStyles } from './FilterBar.styles';

const MAX_PRICE_CEILING = 3_000_000;
interface FilterPriceControlsProps {
  minPrice: number;
  maxPrice: number;
  inSheet?: boolean;
  onDone?: () => void;
  onPriceChange: (min: number, max: number) => void;
  onPriceDraftChange?: (min: number, max: number) => void;
}
function normalizePriceInput(value: string, fallback: number) {
  if (value.trim() === '') {
    return fallback;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(MAX_PRICE_CEILING, Math.max(0, parsedValue));
}

function formatMinPriceInput(value: number) {
  return value > 0 ? value.toString() : '';
}

function formatMaxPriceInput(value: number) {
  return value < MAX_PRICE_CEILING ? value.toString() : '';
}

export function FilterPriceControls({
  minPrice,
  maxPrice,
  inSheet = false,
  onDone,
  onPriceChange,
  onPriceDraftChange,
}: FilterPriceControlsProps) {
  const [tempMinPrice, setTempMinPrice] = useState(
    formatMinPriceInput(minPrice)
  );
  const [tempMaxPrice, setTempMaxPrice] = useState(
    formatMaxPriceInput(maxPrice)
  );
  const [prevMinPrice, setPrevMinPrice] = useState(minPrice);
  const [prevMaxPrice, setPrevMaxPrice] = useState(maxPrice);
  const { colors } = useTheme();
  const styles = getFilterBarStyles(colors);

  // Re-sync the draft inputs inline during render (prev-prop comparison)
  // instead of in an effect, so the inputs never show a stale frame.
  if (minPrice !== prevMinPrice || maxPrice !== prevMaxPrice) {
    setPrevMinPrice(minPrice);
    setPrevMaxPrice(maxPrice);
    setTempMinPrice(formatMinPriceInput(minPrice));
    setTempMaxPrice(formatMaxPriceInput(maxPrice));
  }

  const handlePriceBlur = () => {
    const nextMinPrice = normalizePriceInput(tempMinPrice, 0);
    const nextMaxPrice = normalizePriceInput(tempMaxPrice, MAX_PRICE_CEILING);

    setTempMinPrice(formatMinPriceInput(nextMinPrice));
    setTempMaxPrice(formatMaxPriceInput(nextMaxPrice));
    onPriceChange(nextMinPrice, nextMaxPrice);
  };
  const PriceInput = inSheet ? BottomSheetTextInput : TextInput;
  return (
    <View>
      <View style={styles.priceRow}>
        <View style={styles.priceField}>
          <Text style={styles.currency}>₦</Text>
          <PriceInput
            style={styles.priceInput}
            value={tempMinPrice}
            onChangeText={(value) => {
              setTempMinPrice(value);
              onPriceDraftChange?.(
                normalizePriceInput(value, 0),
                normalizePriceInput(tempMaxPrice, MAX_PRICE_CEILING)
              );
            }}
            role="spinbutton"
            accessibilityLabel="Min"
            placeholder="0"
            keyboardType="numeric"
            onBlur={handlePriceBlur}
            placeholderTextColor={colors.placeholder}
          />
        </View>
        <Text style={styles.dash}>-</Text>
        <View style={styles.priceField}>
          <Text style={styles.currency}>₦</Text>
          <PriceInput
            style={styles.priceInput}
            value={tempMaxPrice}
            onChangeText={(value) => {
              setTempMaxPrice(value);
              onPriceDraftChange?.(
                normalizePriceInput(tempMinPrice, 0),
                normalizePriceInput(value, MAX_PRICE_CEILING)
              );
            }}
            role="spinbutton"
            accessibilityLabel="Max"
            placeholder="Max"
            keyboardType="numeric"
            onBlur={handlePriceBlur}
            placeholderTextColor={colors.placeholder}
          />
        </View>
      </View>
      {inSheet && (
        <SheetDoneButton
          onPress={() => {
            handlePriceBlur();
            onDone?.();
          }}
        />
      )}
    </View>
  );
}
