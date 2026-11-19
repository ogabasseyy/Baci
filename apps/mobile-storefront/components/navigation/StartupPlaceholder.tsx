import { StyleSheet, Text, View } from 'react-native';

export function StartupPlaceholder({
  showProgress,
}: {
  showProgress: boolean;
}) {
  return (
    <View testID="startup-placeholder" style={styles.container}>
      {showProgress ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          Getting things ready…
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#20000b',
    flex: 1,
    justifyContent: 'center',
  },
  message: { color: '#fff', fontSize: 14 },
});
