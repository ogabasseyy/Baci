import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Keeps route-level panels behind inline overlays and out of interaction. */
export function CartRouteOverlayBoundary({
  children,
  overlay,
  overlayVisible,
}: {
  children: ReactNode;
  overlay: ReactNode;
  overlayVisible: boolean;
}) {
  return (
    <View style={styles.root}>
      <View
        style={[
          styles.content,
          { pointerEvents: overlayVisible ? 'none' : 'auto' },
        ]}
        importantForAccessibility={
          overlayVisible ? 'no-hide-descendants' : 'auto'
        }
        accessibilityElementsHidden={overlayVisible}
      >
        {children}
      </View>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
