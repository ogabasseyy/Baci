import {
  Pressable,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SPACING } from '@/constants/Colors';
import styles from './DrawerMenu.styles';

interface DrawerMenuFooterColors {
  background: string;
  border: string;
  foreground: string;
  muted: string;
  textSecondary: string;
}

interface DrawerMenuFooterProps {
  appVersion: string;
  authButtonShadowStyle?: StyleProp<ViewStyle>;
  bottomInset: number;
  colors: DrawerMenuFooterColors;
  currentYear: number;
  isAuthenticated: boolean;
  onAuthPress: () => void;
}

/**
 * Drawer footer with the auth entry point and version stamp. Extracted from
 * DrawerMenu so the drawer module stays within the 300-line module-size
 * gate.
 */
export function DrawerMenuFooter({
  appVersion,
  authButtonShadowStyle,
  bottomInset,
  colors,
  currentYear,
  isAuthenticated,
  onAuthPress,
}: DrawerMenuFooterProps) {
  return (
    <View
      style={[
        styles.footer,
        {
          paddingBottom: bottomInset + SPACING.md,
          borderTopColor: colors.border,
          backgroundColor: colors.muted,
        },
      ]}
    >
      <Pressable
        style={[
          styles.authButton,
          authButtonShadowStyle,
          { backgroundColor: colors.foreground },
        ]}
        onPress={onAuthPress}
        accessibilityLabel={isAuthenticated ? 'Sign out' : 'Login or Register'}
        accessibilityRole="button"
      >
        <Text style={[styles.authButtonText, { color: colors.background }]}>
          {isAuthenticated ? 'Sign Out' : 'Login / Register'}
        </Text>
      </Pressable>
      <Text style={[styles.versionText, { color: colors.textSecondary }]}>
        v{appVersion} • &copy; {currentYear} Ogabassey
      </Text>
    </View>
  );
}
