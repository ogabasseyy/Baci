import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

/** Diameter each scallop aims for; the count adapts so they stay round. */
const SCALLOP_SIZE = 14;
const SCALLOP_RADIUS = SCALLOP_SIZE / 2;

export function getQuizScallopCount(lengthPx: number): number {
  return Math.max(2, Math.round(lengthPx / SCALLOP_SIZE));
}

interface QuizTicketBackdropProps {
  color: string;
}

/**
 * Scalloped tile backdrop for quiz tickets and answer tiles. The home tiles
 * use a fixed scallop count, which stretches into flat lumps on large or tall
 * tiles; this one measures itself and keeps every scallop round at any size.
 */
export function QuizTicketBackdrop({ color }: QuizTicketBackdropProps) {
  const [size, setSize] = useState<{ height: number; width: number } | null>(
    null
  );
  const fill = { backgroundColor: color };
  const handleLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    if (size && size.height === height && size.width === width) return;
    setSize({ height, width });
  };
  const innerWidth = Math.max(0, (size?.width ?? 0) - SCALLOP_SIZE);
  const innerHeight = Math.max(0, (size?.height ?? 0) - SCALLOP_SIZE);
  const across = Array.from(
    { length: size ? getQuizScallopCount(innerWidth) : 0 },
    (_, index) => index
  );
  const down = Array.from(
    { length: size ? getQuizScallopCount(innerHeight) : 0 },
    (_, index) => index
  );

  return (
    <View
      onLayout={handleLayout}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      testID="quiz-ticket-backdrop"
    >
      {/* Until measured, a plain rounded tile avoids a frame with bare edges. */}
      <View style={[size ? styles.center : styles.unmeasured, fill]} />
      {(['top', 'bottom'] as const).map((edge) => (
        <View key={edge} style={[styles.horizontal, styles[edge]]}>
          {across.map((scallop) => (
            <View key={scallop} style={[styles.scallop, fill]} />
          ))}
        </View>
      ))}
      {(['left', 'right'] as const).map((edge) => (
        <View key={edge} style={[styles.vertical, styles[edge]]}>
          {down.map((scallop) => (
            <View key={scallop} style={[styles.scallop, fill]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: { bottom: 0 },
  center: {
    borderRadius: 4,
    bottom: SCALLOP_RADIUS,
    left: SCALLOP_RADIUS,
    position: 'absolute',
    right: SCALLOP_RADIUS,
    top: SCALLOP_RADIUS,
  },
  unmeasured: {
    borderRadius: 8,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  horizontal: {
    flexDirection: 'row',
    height: SCALLOP_SIZE,
    left: SCALLOP_RADIUS,
    position: 'absolute',
    right: SCALLOP_RADIUS,
  },
  left: { left: 0 },
  right: { right: 0 },
  scallop: { borderRadius: 999, flex: 1 },
  top: { top: 0 },
  vertical: {
    bottom: SCALLOP_RADIUS,
    position: 'absolute',
    top: SCALLOP_RADIUS,
    width: SCALLOP_SIZE,
  },
});
