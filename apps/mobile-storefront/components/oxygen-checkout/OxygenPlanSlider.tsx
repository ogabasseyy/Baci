import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import { oxygenMoney } from './oxygen-presentation';
/** Direct touch updates; no springs, layout animation or JS animation loop. */
export function OxygenPlanSlider({
  value,
  min,
  max,
  total,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  total: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const colors = useOxygenColors();
  const width = useRef(1);
  const last = useRef(value);
  const gestureOrigin = useRef<number | null>(null);
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : min;
  function change(x: number) {
    if (disabled) return;
    const next = Math.max(
      min,
      Math.min(max, Math.round((x / width.current) * 10000) / 100)
    );
    if (next !== last.current) {
      last.current = next;
      onChange(next);
    }
  }
  return (
    <View style={{ gap: 2 }}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Down payment slider"
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min,
          max,
          now: safe,
          text: `${safe}% down payment`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (disabled) return;
          const delta = e.nativeEvent.actionName === 'increment' ? 100 : -100;
          const next = (Math.round(safe * 100) + delta) / 100;
          onChange(Math.max(min, Math.min(max, next)));
        }}
        onLayout={(e) => {
          width.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => !disabled}
        onResponderGrant={(e) => {
          Keyboard.dismiss();
          last.current = value;
          gestureOrigin.current = Number.isFinite(e.nativeEvent.pageX)
            ? e.nativeEvent.pageX - e.nativeEvent.locationX
            : null;
          change(e.nativeEvent.locationX);
        }}
        onResponderMove={(e) =>
          change(
            gestureOrigin.current !== null &&
              Number.isFinite(e.nativeEvent.pageX)
              ? e.nativeEvent.pageX - gestureOrigin.current
              : e.nativeEvent.locationX
          )
        }
        onResponderRelease={(e) => {
          change(
            gestureOrigin.current !== null &&
              Number.isFinite(e.nativeEvent.pageX)
              ? e.nativeEvent.pageX - gestureOrigin.current
              : e.nativeEvent.locationX
          );
          gestureOrigin.current = null;
        }}
        onResponderTerminationRequest={() => true}
        style={styles.touch}
      >
        <View
          style={[
            styles.track,
            { backgroundColor: colors.border, pointerEvents: 'none' },
          ]}
        >
          <View
            style={[
              styles.fill,
              { backgroundColor: colors.primary, width: `${safe}%` },
            ]}
          />
          {[25, 50, 75].map((mark) => (
            <View
              key={mark}
              style={[
                styles.mark,
                {
                  left: `${mark}%`,
                  backgroundColor:
                    mark <= safe
                      ? colors.primaryForeground
                      : colors.textSecondary,
                },
              ]}
            />
          ))}
        </View>
        <View
          style={[
            styles.thumb,
            { pointerEvents: 'none' },
            {
              left: `${safe}%`,
              backgroundColor: colors.primary,
              borderColor: colors.card,
            },
          ]}
        >
          <Ionicons
            name="chevron-forward"
            size={19}
            color={colors.primaryForeground}
          />
        </View>
      </View>
      <View style={styles.labels}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {min}% · {oxygenMoney((total * min) / 100)}
        </Text>
        <Text
          style={[
            styles.label,
            { color: colors.textSecondary, textAlign: 'right' },
          ]}
        >
          {max}% · {oxygenMoney((total * max) / 100)}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  touch: { height: 52, justifyContent: 'center' },
  track: { height: 6, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 4 },
  mark: {
    position: 'absolute',
    top: 1,
    width: 4,
    height: 4,
    borderRadius: 2,
    marginLeft: -2,
  },
  thumb: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 18,
    borderWidth: 3,
    marginLeft: -17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  label: { fontSize: 11, fontVariant: ['tabular-nums'], flexShrink: 1 },
});
