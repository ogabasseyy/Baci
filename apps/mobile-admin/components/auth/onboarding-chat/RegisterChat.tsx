import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RegisterLegalText } from '@/components/auth/register/RegisterLegalText';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import { getVirtualizedListProps } from '@/components/ui/virtualized-list-props';
import { useTheme } from '@/hooks/useTheme';
import { getOnboardingChatStyles } from './onboarding-chat.styles';
import type { OnboardingChatMessage } from './onboarding-chat.types';
import { type RegisterChatStep, useRegisterChat } from './useRegisterChat';

function getInputMeta(step: RegisterChatStep) {
  switch (step) {
    case 'full_name':
      return {
        accessibilityLabel: 'Full name',
        autoCapitalize: 'words' as const,
        keyboardType: 'default' as const,
        placeholder: 'e.g. Ada Okafor',
        isPassword: false,
      };
    case 'email':
      return {
        accessibilityLabel: 'Email address',
        autoCapitalize: 'none' as const,
        keyboardType: 'email-address' as const,
        placeholder: 'you@example.com',
        isPassword: false,
      };
    case 'password':
      return {
        accessibilityLabel: 'Password',
        autoCapitalize: 'none' as const,
        keyboardType: 'default' as const,
        placeholder: 'Create a strong password...',
        isPassword: true,
      };
    case 'confirm_password':
      return {
        accessibilityLabel: 'Confirm Password',
        autoCapitalize: 'none' as const,
        keyboardType: 'default' as const,
        placeholder: 'Re-enter your password...',
        isPassword: true,
      };
  }
}

export function RegisterChat() {
  const { colors } = useTheme();
  const styles = getOnboardingChatStyles(colors);
  const flatListRef = useRef<FlatList<OnboardingChatMessage>>(null);
  const {
    handleQuickReply,
    handleSendText,
    inputText,
    isSubmitting,
    messages,
    quickReplies,
    setInputText,
    showPassword,
    step,
    toggleShowPassword,
  } = useRegisterChat();

  useEffect(() => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd?.({ animated: true });
    }
  }, [messages.length]);

  const inputMeta = getInputMeta(step);
  const hasValue = inputMeta.isPassword
    ? inputText.length > 0
    : inputText.trim().length > 0;
  const canSend = hasValue && !isSubmitting;

  return (
    <AppKeyboardContainer
      align="start"
      offsetPreset="compactHeader"
      scrollEnabled={false}
      style={styles.container}
    >
      <View style={styles.content}>
        <FlatList
          ref={flatListRef}
          contentContainerStyle={styles.messagesList}
          data={messages}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd?.({ animated: true });
          }}
          {...getVirtualizedListProps()}
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            const isSystem = item.role === 'system';
            return (
              <View
                style={[
                  styles.messageRow,
                  isUser ? styles.userRow : styles.assistantRow,
                ]}
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
                    {item.text}
                  </Text>
                </View>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
        />

        {isSubmitting ? (
          <View style={styles.thinkingPill}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.thinkingText}>Creating account...</Text>
          </View>
        ) : null}

        {quickReplies.length > 0 ? (
          <View style={styles.quickRepliesWrap}>
            {quickReplies.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => handleQuickReply(option)}
                style={[
                  styles.quickReplyChip,
                  option.variant === 'secondary' &&
                    styles.quickReplyChipSecondary,
                ]}
              >
                <Text
                  style={[
                    styles.quickReplyText,
                    option.variant === 'secondary' &&
                      styles.quickReplyTextSecondary,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.inputContainer}>
          <TextInput
            accessibilityLabel={inputMeta.accessibilityLabel}
            autoCapitalize={inputMeta.autoCapitalize}
            autoCorrect={!inputMeta.isPassword && step !== 'email'}
            editable={!isSubmitting}
            keyboardType={inputMeta.keyboardType}
            onChangeText={setInputText}
            onSubmitEditing={handleSendText}
            placeholder={inputMeta.placeholder}
            placeholderTextColor={colors.textMuted}
            returnKeyType="send"
            secureTextEntry={inputMeta.isPassword && !showPassword}
            style={styles.textInput}
            value={inputText}
          />
          {inputMeta.isPassword ? (
            <Pressable
              accessibilityLabel={
                showPassword ? 'Hide password' : 'Show password'
              }
              accessibilityRole="button"
              onPress={toggleShowPassword}
              style={styles.sendButton}
            >
              <Ionicons
                color={colors.textSecondary}
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={
              isSubmitting ? 'Creating account...' : 'Send response'
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={handleSendText}
            style={[
              styles.sendButton,
              { backgroundColor: canSend ? colors.primary : colors.border },
            ]}
          >
            <Ionicons
              color={canSend ? colors.textOnPrimary : colors.textMuted}
              name="send"
              size={18}
            />
          </Pressable>
        </View>

        <RegisterLegalText prefixText="By creating an account, you agree to our" />
      </View>
    </AppKeyboardContainer>
  );
}
