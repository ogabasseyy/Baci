import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SharedCartStatusPanel } from './SharedCartStatusPanel';

/**
 * Full-screen host for the shared-cart status panel when it is the
 * whole cart screen: themed background, safe-area insets, and a
 * scrollable body so every conflict and its actions stay reachable
 * on small devices.
 */
export function CartStatusOnlyScreen() {
  const insets = useSafeAreaInsets();
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <SharedCartStatusPanel />
    </ScrollView>
  );
}
