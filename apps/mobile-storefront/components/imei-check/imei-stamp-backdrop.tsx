import { StyleSheet, View } from 'react-native';

const ACROSS = Array.from({ length: 9 }, (_, index) => index);
const DOWN = Array.from({ length: 8 }, (_, index) => index);

/**
 * The scalloped "stamp" tile of the refreshed Ogabassey home: a filled
 * centre with round bites along every edge. Mirrors the home's
 * ShortcutTileBackdrop (#4252); switch to that one once it is on main.
 */
export function ImeiStampBackdrop({ color }: { color: string }) {
  const fill = { backgroundColor: color };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.center, fill]} />
      {(['top', 'bottom'] as const).map((edge) => (
        <View key={edge} style={[styles.across, styles[edge]]}>
          {ACROSS.map((scallop) => (
            <View key={scallop} style={[styles.scallop, fill]} />
          ))}
        </View>
      ))}
      {(['left', 'right'] as const).map((edge) => (
        <View key={edge} style={[styles.down, styles[edge]]}>
          {DOWN.map((scallop) => (
            <View key={scallop} style={[styles.scallop, fill]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', inset: 4, borderRadius: 3 },
  across: { position: 'absolute', left: 4, right: 4, flexDirection: 'row' },
  down: { position: 'absolute', top: 5, bottom: 5, width: 8 },
  top: { top: 0 },
  bottom: { bottom: 0 },
  left: { left: 0 },
  right: { right: 0 },
  scallop: { flex: 1, minHeight: 8, borderRadius: 99 },
});
