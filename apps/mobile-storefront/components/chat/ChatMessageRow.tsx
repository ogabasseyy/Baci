import { Linking, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { styles } from './styles';
import type { ChatMessage } from './types';

interface ChatMessageTheme {
  border: string;
  card: string;
  muted: string;
  text: string;
}

interface ChatMessageRowProps {
  item: ChatMessage;
  santaMode: boolean;
  colors: ChatMessageTheme;
}

function trustedStorefrontLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'ogabassey.com' &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function assistantMessageText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/gi);
  return parts.map((part, index) =>
    trustedStorefrontLink(part) ? (
      <Text
        accessibilityRole="link"
        // biome-ignore lint/suspicious/noArrayIndexKey: Message text is immutable.
        key={`${index}:${part}`}
        onPress={() => {
          void Linking.openURL(part).catch(() => undefined);
        }}
        style={{ textDecorationLine: 'underline' }}
      >
        {part}
      </Text>
    ) : (
      part
    )
  );
}

export function ChatMessageRow({
  item,
  santaMode,
  colors,
}: ChatMessageRowProps) {
  const isUser = item.role === 'user';

  return (
    <View
      style={[
        styles.messageContainer,
        isUser ? styles.userMessageContainer : styles.aiMessageContainer,
      ]}
    >
      {!isUser && (
        <View
          accessible={false}
          accessibilityElementsHidden={true}
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.avatar,
            { backgroundColor: santaMode ? BRAND.primary : colors.muted },
          ]}
        >
          <Text style={styles.avatarEmoji}>{santaMode ? '🎅' : '✨'}</Text>
        </View>
      )}
      <View
        style={[
          styles.messageBubble,
          isUser
            ? [styles.userBubble, { backgroundColor: BRAND.primary }]
            : [
                styles.aiBubble,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ],
        ]}
      >
        <Text
          style={[
            styles.messageText,
            { color: isUser ? '#FFFFFF' : colors.text },
          ]}
        >
          {isUser ? item.text : assistantMessageText(item.text)}
        </Text>
      </View>
    </View>
  );
}
