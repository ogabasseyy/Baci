import { useState } from 'react';
import {
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextStyle,
} from 'react-native';

interface CartQuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  style?: StyleProp<TextStyle>;
  maxValue?: number;
}

const localStyles = StyleSheet.create({
  input: {
    minWidth: 28,
    textAlign: 'center',
  },
});

export default function CartQuantityInput({
  value,
  onChange,
  style,
  maxValue,
}: CartQuantityInputProps) {
  const [localValue, setLocalValue] = useState(value.toString());
  const [prevValue, setPrevValue] = useState(value);

  // Reset the local draft when the external value changes, during render
  // (guarded prev-prop compare) instead of via a setState-in-effect.
  if (value !== prevValue) {
    setPrevValue(value);
    setLocalValue(value.toString());
  }

  const handleCommit = () => {
    const parsed = Number.parseInt(localValue, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setLocalValue(value.toString());
    } else {
      onChange(maxValue === undefined ? parsed : Math.min(parsed, maxValue));
    }
  };

  return (
    <TextInput
      style={[localStyles.input, style]}
      value={localValue}
      textAlignVertical="center"
      accessibilityLabel="Quantity input"
      accessibilityHint="Enter quantity for this item, must be a positive integer."
      accessibilityRole="adjustable"
      maxLength={maxValue === undefined ? 3 : String(maxValue).length}
      onChangeText={(text) => {
        const cleanText = text.replace(/[^0-9]/g, '');
        setLocalValue(cleanText);
      }}
      onEndEditing={handleCommit}
      keyboardType="number-pad"
      returnKeyType="done"
    />
  );
}
