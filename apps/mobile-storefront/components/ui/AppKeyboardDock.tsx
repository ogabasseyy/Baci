import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

/** Moves one mounted input surface from its bottom resting position to the keyboard. */
export default function AppKeyboardDock({
  availableHeight,
  children,
  bottomInset = 0,
}: {
  availableHeight: number;
  children: ReactNode;
  bottomInset?: number;
}) {
  const [surfaceHeight, setSurfaceHeight] = useState(72);
  return (
    <View
      testID="keyboard-dock-space"
      style={{
        pointerEvents: 'box-none',
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 30,
      }}
    >
      <KeyboardStickyView
        testID="keyboard-dock"
        offset={{
          closed: Math.max(0, availableHeight - surfaceHeight - bottomInset),
          opened: Math.max(0, availableHeight - surfaceHeight),
        }}
        style={styles.surface}
      >
        <View
          onLayout={(event) => {
            const measured = event.nativeEvent.layout.height;
            if (measured > 0) setSurfaceHeight(measured);
          }}
        >
          {children}
        </View>
      </KeyboardStickyView>
    </View>
  );
}
const styles = StyleSheet.create({
  surface: { position: 'absolute', top: 0, left: 0, right: 0 },
});
