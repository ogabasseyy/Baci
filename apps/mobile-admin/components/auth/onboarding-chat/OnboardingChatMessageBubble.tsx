import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { getOnboardingChatStyles } from './onboarding-chat.styles';
import {
  getBusinessTypeLabel,
  getCountryName,
  type OnboardingChatData,
  type OnboardingChatMessage,
} from './onboarding-chat.types';

interface OnboardingChatMessageBubbleProps {
  colors: ThemeColors;
  data: OnboardingChatData;
  message: OnboardingChatMessage;
}

export function OnboardingChatMessageBubble({
  colors,
  data,
  message,
}: OnboardingChatMessageBubbleProps) {
  const styles = getOnboardingChatStyles(colors);
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <View
      style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}
    >
      {!isUser ? (
        <View style={styles.avatarCircle}>
          <Ionicons
            color={isSystem ? colors.error : colors.primary}
            name={isSystem ? 'alert-circle' : 'sparkles'}
            size={15}
          />
        </View>
      ) : null}

      <View
        style={[
          styles.bubble,
          isUser
            ? styles.userBubble
            : isSystem
              ? styles.systemBubble
              : styles.assistantBubble,
        ]}
      >
        <Text
          style={[
            styles.messageText,
            isUser
              ? styles.userText
              : isSystem
                ? styles.systemText
                : styles.assistantText,
          ]}
        >
          {message.text}
        </Text>

        {message.logoPreviewUri ? (
          <View style={styles.logoPreviewWrapper}>
            <Image
              accessibilityLabel="Generated store logo preview"
              contentFit="contain"
              source={{ uri: message.logoPreviewUri }}
              style={styles.logoPreviewImage}
            />
            {message.brandColors ? (
              <View style={styles.swatchesRow}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: message.brandColors.primary },
                  ]}
                />
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: message.brandColors.accent },
                  ]}
                />
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: message.brandColors.background },
                  ]}
                />
                <Text style={styles.swatchLabel}>Brand palette</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {message.isSummary ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Owner</Text>
              <Text style={styles.summaryValue}>
                {`${data.firstName} ${data.lastName}`.trim()}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Country</Text>
              <Text style={styles.summaryValue}>
                {getCountryName(data.country)}
              </Text>
            </View>
            {data.phone ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Phone</Text>
                <Text style={styles.summaryValue}>{data.phone}</Text>
              </View>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Store</Text>
              <Text style={styles.summaryValue}>{data.businessName}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Category</Text>
              <Text style={styles.summaryValue}>
                {getBusinessTypeLabel(
                  data.businessType,
                  data.otherBusinessType
                )}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Store Link</Text>
              <Text style={styles.summaryValue}>
                {`${data.slug}.usebaci.com`}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
