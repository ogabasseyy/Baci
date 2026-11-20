import type { PropsWithChildren } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export function ModalSafeArea({
  backdropColor,
  children,
  onBackdropPress,
  style,
}: PropsWithChildren<{
  backdropColor: string;
  onBackdropPress: () => void;
  style: StyleProp<ViewStyle>;
}>) {
  return (
    <View style={styles.window}>
      <Pressable
        accessible={false}
        onPress={onBackdropPress}
        style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]}
      />
      <SafeAreaProvider pointerEvents="box-none">
        <SafeAreaView pointerEvents="box-none" style={style}>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({ window: { flex: 1 } });
