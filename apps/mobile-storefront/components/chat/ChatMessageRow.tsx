import { Fragment } from 'react';
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
  return parts.map((part, index) => {
    let parentheses = 0;
    let brackets = 0;
    for (const character of part) {
      if (character === '(') parentheses++;
      if (character === ')') parentheses--;
      if (character === '[') brackets++;
      if (character === ']') brackets--;
    }
    let end = part.length;
    while (end > 0) {
      const last = part[end - 1];
      if (/[.,!?;:]/.test(last)) end--;
      else if (last === ')' && parentheses < 0) {
        parentheses++;
        end--;
      } else if (last === ']' && brackets < 0) {
        brackets++;
        end--;
      } else break;
    }
    const url = part.slice(0, end);
    if (!trustedStorefrontLink(url)) return part;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: Message text is immutable.
      <Fragment key={`${index}:${part}`}>
        <Text
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(url).catch(() => undefined);
          }}
          style={{ textDecorationLine: 'underline' }}
        >
          {url}
        </Text>
        {part.slice(end)}
      </Fragment>
    );
  });
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
