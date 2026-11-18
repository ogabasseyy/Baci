import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { OxygenBirthDateInput } from './OxygenBirthDateInput';
import { useOxygenColors } from './OxygenFormPrimitives';
import {
  formatOxygenBirthDateInput,
  oxygenBirthDateInput,
  parseOxygenBirthDateInput,
} from './oxygen-birth-calendar';

/** Keep per-keystroke state here, outside the calendar grid and modal. */
export function OxygenBirthDateEditor({
  value,
  onDateChange,
}: {
  value?: string;
  onDateChange: (date?: string) => void;
}) {
  const colors = useOxygenColors();
  const [today] = useState(() => new Date());
  const [text, setText] = useState(oxygenBirthDateInput(value));
  const [blurred, setBlurred] = useState(false);
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(oxygenBirthDateInput(value));
      setBlurred(false);
    }
  }, [value]);
  const valid = parseOxygenBirthDateInput(text, today);
  const error = !!text && !valid && (text.length === 10 || blurred);
  return (
    <View style={{ gap: 8 }}>
      <OxygenBirthDateInput
        value={text}
        onBlur={() => setBlurred(true)}
        error={error}
        onChangeText={(input) => {
          const nextText = formatOxygenBirthDateInput(input);
          const nextDate = parseOxygenBirthDateInput(nextText, today);
          setText(nextText);
          setBlurred(false);
          if (nextDate !== emitted.current) {
            emitted.current = nextDate;
            onDateChange(nextDate);
          }
        }}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, fontSize: 13 }}
        >
          Enter a valid date as DD/MM/YYYY, no later than today.
        </Text>
      ) : null}
    </View>
  );
}
