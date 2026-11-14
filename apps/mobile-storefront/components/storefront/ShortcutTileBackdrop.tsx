import { StyleSheet, View } from 'react-native';

const horizontalScallops = Array.from({ length: 9 }, (_, index) => index);
const verticalScallops = Array.from({ length: 8 }, (_, index) => index);

const searchVerticalScallops = Array.from({ length: 5 }, (_, index) => index);

export function ShortcutTileBackdrop({
  color,
  shortEdgesOnly = false,
}: {
  color: string;
  shortEdgesOnly?: boolean;
}) {
  const vertical = shortEdgesOnly ? searchVerticalScallops : verticalScallops;
  const fill = { backgroundColor: color };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[styles.center, shortEdgesOnly && styles.flatCenter, fill]}
      />
      {!shortEdgesOnly &&
        (['top', 'bottom'] as const).map((edge) => (
          <View key={edge} style={[styles.horizontal, styles[edge]]}>
            {horizontalScallops.map((scallop) => (
              <View key={scallop} style={[styles.scallop, fill]} />
            ))}
          </View>
        ))}
      {(['left', 'right'] as const).map((edge) => (
        <View
          key={edge}
          style={[
            styles.vertical,
            shortEdgesOnly && styles.fullHeight,
            styles[edge],
          ]}
        >
          {vertical.map((scallop) => (
            <View key={scallop} style={[styles.scallop, fill]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', inset: 4, borderRadius: 3 },
  flatCenter: { top: 0, bottom: 0, borderRadius: 0 },
  fullHeight: { top: 0, bottom: 0 },
  horizontal: { position: 'absolute', left: 4, right: 4, flexDirection: 'row' },
  vertical: { position: 'absolute', top: 5, bottom: 5, width: 8 },
  top: { top: 0 },
  bottom: { bottom: 0 },
  left: { left: 0 },
  right: { right: 0 },
  scallop: { flex: 1, minHeight: 8, borderRadius: 99 },
});
