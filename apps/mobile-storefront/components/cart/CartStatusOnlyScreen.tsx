import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SharedCartStatusPanel } from './SharedCartStatusPanel';

/**
 * Full-screen host for the shared-cart status panel when it is the
 * whole cart screen: themed background and safe-area top inset, so
 * the banner-style panel never underlaps the status bar or notch.
 */
export function CartStatusOnlyScreen() {
  const insets = useSafeAreaInsets();
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      <SharedCartStatusPanel />
    </View>
  );
}
