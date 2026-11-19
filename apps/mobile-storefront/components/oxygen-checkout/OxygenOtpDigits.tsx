import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
export function OxygenOtpDigits({
  value,
  pending,
  confirmed,
  settled,
  progress,
  focused,
  error,
}: {
  value: string;
  pending: boolean;
  confirmed: boolean;
  settled: boolean;
  progress: Animated.Value;
  focused: boolean;
  error: boolean;
}) {
  const colors = useOxygenColors();
  const [width, setWidth] = useState(0);
  return (
    <View
      style={styles.area}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {settled ? (
        <View
          accessibilityLabel="Code confirmed"
          style={[styles.success, { backgroundColor: colors.muted }]}
        >
          <Ionicons name="checkmark-circle" size={52} color={colors.success} />
        </View>
      ) : (
        <View
          accessible={false}
          style={[styles.row, { pointerEvents: 'none' }]}
        >
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Animated.View
              key={index}
              style={[
                styles.digit,
                {
                  backgroundColor: confirmed ? colors.primary : colors.muted,
                  borderColor: confirmed
                    ? colors.primary
                    : error
                      ? colors.error
                      : focused &&
                          !pending &&
                          index === Math.min(value.length, 5)
                        ? colors.primary
                        : colors.border,
                  transform: [
                    {
                      translateX: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, ((2.5 - index) * (width + 6)) / 6],
                      }),
                    },
                    {
                      scale: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0.94],
                      }),
                    },
                  ],
                  opacity: progress.interpolate({
                    inputRange: [0, 0.85, 1],
                    outputRange: [1, 1, 0],
                  }),
                },
              ]}
            >
              <Animated.Text
                style={[
                  styles.number,
                  {
                    color: colors.text,
                    opacity: confirmed ? 0 : pending ? 0.6 : 1,
                  },
                ]}
              >
                {value[index] ?? ' '}
              </Animated.Text>
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  area: { height: 64, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 6 },
  digit: {
    flex: 1,
    height: 56,
    borderWidth: 1.5,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontSize: 23, fontWeight: '600', fontVariant: ['tabular-nums'] },
  success: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
