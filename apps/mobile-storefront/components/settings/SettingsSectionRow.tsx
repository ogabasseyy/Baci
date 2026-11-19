import Ionicons from '@react-native-vector-icons/ionicons';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles } from './styles';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

type SectionRowProps = {
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'radio';
  borderBottom?: boolean;
  borderColor?: string;
  icon: IoniconsName;
  iconBackgroundColor: string;
  iconColor: string;
  label: string;
  labelColor: string;
  onPress?: () => void;
  right: ReactNode;
  subtitle?: string;
  subtitleColor?: string;
};

export function SettingsSectionRow({
  accessibilityLabel,
  accessibilityRole,
  borderBottom,
  borderColor,
  icon,
  iconBackgroundColor,
  iconColor,
  label,
  labelColor,
  onPress,
  right,
  subtitle,
  subtitleColor,
}: SectionRowProps) {
  const [pressed, setPressed] = useState(false);
  const computedRole = accessibilityRole ?? (onPress ? 'button' : undefined);
  const computedSubtitleColor = subtitleColor ?? labelColor;

  // Layout lives on plain Views: the Pressable style callback can be dropped
  // at runtime (RN New Architecture), which stacked every row's content.
  return (
    <View
      testID="settings-row"
      style={[
        styles.row,
        borderBottom && styles.rowBorder,
        borderBottom && borderColor ? { borderBottomColor: borderColor } : null,
        pressed && onPress ? styles.rowPressed : null,
      ]}
    >
      <Pressable
        disabled={!onPress}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={computedRole}
        style={styles.rowPressable}
      >
        <View testID="settings-row-content" style={styles.rowContent}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: iconBackgroundColor },
            ]}
          >
            <Ionicons
              name={icon}
              size={20}
              color={iconColor}
              accessible={false}
              importantForAccessibility="no"
            />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: labelColor }]}>
              {label}
            </Text>
            {subtitle ? (
              <Text style={[styles.rowSub, { color: computedSubtitleColor }]}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View testID="settings-row-right" style={styles.rowRight}>
            {right}
          </View>
        </View>
      </Pressable>
    </View>
  );
}
