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
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
import { CountryPickerModal } from '@/components/ui/CountryPickerModal';
import { getVirtualizedListProps } from '@/components/ui/virtualized-list-props';
import { useTheme } from '@/hooks/useTheme';
import { OnboardingChatMessageBubble } from './OnboardingChatMessageBubble';
import {
  getQuickRepliesForStep,
  getStepInputConfig,
} from './onboarding-chat.prompts';
import { getOnboardingChatStyles } from './onboarding-chat.styles';
import type { OnboardingChatMessage } from './onboarding-chat.types';
import { useMerchantSetupChat } from './useMerchantSetupChat';

export function MerchantSetupChat() {
  const { colors } = useTheme();
  const styles = getOnboardingChatStyles(colors);
  const flatListRef = useRef<FlatList<OnboardingChatMessage>>(null);
  const {
    data,
    handleQuickReply,
    handleSelectCountry,
    handleSendText,
    hasRejectedSlug,
    inputText,
    isBusy,
    isCountryModalOpen,
    isCustomizingSlug,
    isProvisioning,
    logoPreviewSource,
    messages,
    setInputText,
    setIsCountryModalOpen,
    step,
    suggestedNames,
    user,
  } = useMerchantSetupChat();

  useEffect(() => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd?.({ animated: true });
    }
  }, [messages.length]);

  if (!user) {
    return null;
  }

  const inputConfig = getStepInputConfig(step, isCustomizingSlug);
  const quickReplies = getQuickRepliesForStep({
    step,
    suggestedNames,
    logoPreviewSource,
    isCustomizingSlug,
    hasRejectedSlug,
    isProvisioning,
  });
  const canSend = inputText.trim().length > 0 && !isBusy;

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
          renderItem={({ item }) => (
            <OnboardingChatMessageBubble
              colors={colors}
              data={data}
              message={item}
            />
          )}
          showsVerticalScrollIndicator={false}
        />

        {isBusy ? (
          <View style={styles.thinkingPill}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.thinkingText}>
              {isProvisioning
                ? 'Setting up your store...'
                : 'Baci is thinking...'}
            </Text>
          </View>
        ) : null}

        {quickReplies.length > 0 ? (
          <View style={styles.quickRepliesWrap}>
            {quickReplies.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => handleQuickReply(option)}
                style={[
                  styles.quickReplyChip,
                  option.variant === 'accent' && styles.quickReplyChipAccent,
                  option.variant === 'secondary' &&
                    styles.quickReplyChipSecondary,
                ]}
              >
                <Text
                  style={[
                    styles.quickReplyText,
                    option.variant === 'accent' && styles.quickReplyTextAccent,
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
            accessibilityLabel={inputConfig.accessibilityLabel}
            autoCapitalize={inputConfig.autoCapitalize}
            editable={!isBusy}
            keyboardType={inputConfig.keyboardType}
            maxLength={200}
            onChangeText={setInputText}
            onSubmitEditing={handleSendText}
            placeholder={inputConfig.placeholder}
            placeholderTextColor={colors.textMuted}
            returnKeyType="send"
            style={styles.textInput}
            value={inputText}
          />
          <Pressable
            accessibilityLabel="Send response"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={handleSendText}
            style={[
              styles.sendButton,
              {
                backgroundColor: canSend ? colors.primary : colors.border,
              },
            ]}
          >
            <Ionicons
              color={canSend ? colors.textOnPrimary : colors.textMuted}
              name="send"
              size={18}
            />
          </Pressable>
        </View>
      </View>

      <CountryPickerModal
        onClose={() => setIsCountryModalOpen(false)}
        onSelect={(country) => handleSelectCountry(country.code, country.name)}
        selectedCountry={data.country}
        visible={isCountryModalOpen}
      />
    </AppKeyboardContainer>
  );
}
