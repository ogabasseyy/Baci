import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CustomizeChatPanel,
  type CustomizeMessage,
} from '@/components/customize/CustomizeChatPanel';
import { CustomizePreviewSwitch } from '@/components/customize/CustomizePreviewSwitch';
import { CustomizeViewModeToggle } from '@/components/customize/CustomizeViewModeToggle';
import { customizeStyles } from '@/components/customize/customize.styles';
import { ScreenSkeleton } from '@/components/ui/ScreenSkeleton';
import { type BuilderConfig, useBuilderConfig } from '@/hooks/useBuilderConfig';
import { useTheme } from '@/hooks/useTheme';

export default function CustomizeScreen() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const flatListRef = useRef<FlatList<CustomizeMessage> | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const [inputText, setInputText] = useState('');
  const [viewMode, setViewMode] = useState<'chat' | 'preview'>('chat');
  const [previewKey, setPreviewKey] = useState(0);

  const {
    config,
    configError,
    hasUnsavedChanges,
    isLoadingConfig,
    isProcessingAI,
    isPublishing,
    isSavingDraft,
    messages,
    publish,
    saveDraft,
    sendMessage,
  } = useBuilderConfig();

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        flatListRef.current?.scrollToEnd({ animated: true });
      }
      scrollTimeoutRef.current = null;
    }, 100);

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [messages.length]);

  // Bump the preview cache-buster whenever the config identity changes.
  // Adjusted during render (instead of in an effect) so the refreshed preview
  // URL lands in the same commit as the new config.
  const [prevConfig, setPrevConfig] = useState<BuilderConfig | null>(null);

  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config) {
      setPreviewKey((currentKey) => currentKey + 1);
    }
  }

  const handleSend = async () => {
    const prompt = inputText.trim();
    if (!prompt || isProcessingAI) {
      return;
    }

    setInputText('');

    try {
      await sendMessage(prompt);
    } catch (error) {
      console.error('AI request failed:', error);
    }
  };

  const handleSaveDraft = () => {
    saveDraft(undefined, {
      onError: (error) => {
        Alert.alert('Error', error.message || 'Failed to save draft');
      },
      onSuccess: () => {
        Alert.alert('Saved', 'Your changes have been saved as a draft.');
      },
    });
  };

  const handlePublish = () => {
    Alert.alert(
      'Publish Changes',
      'This will make your changes live on your storefront. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: () => {
            publish(undefined, {
              onError: (error) => {
                Alert.alert('Error', error.message || 'Failed to publish');
              },
              onSuccess: () => {
                Alert.alert('Published!', 'Your storefront has been updated.', [
                  { text: 'OK', onPress: () => router.back() },
                ]);
              },
            });
          },
        },
      ]
    );
  };

  if (isLoadingConfig) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[
          customizeStyles.container,
          { backgroundColor: colors.background },
        ]}
      >
        <Stack.Screen
          options={{
            title: 'AI Copilot',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
        <ScreenSkeleton cards={3} variant="settings" />
      </SafeAreaView>
    );
  }

  if (configError) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[
          customizeStyles.container,
          { backgroundColor: colors.background },
        ]}
      >
        <Stack.Screen
          options={{
            title: 'AI Copilot',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
        <View style={customizeStyles.errorContainer}>
          <Ionicons name="cloud-offline" size={48} color={colors.textMuted} />
          <Text style={[customizeStyles.errorText, { color: colors.text }]}>
            Failed to load configuration
          </Text>
          <Text
            style={[
              customizeStyles.errorSubtext,
              { color: colors.textSecondary },
            ]}
          >
            {configError.message}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[
        customizeStyles.container,
        { backgroundColor: colors.background },
      ]}
    >
      <Stack.Screen
        options={{
          title: 'AI Copilot',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerRight: () => (
            <View style={customizeStyles.headerActions}>
              {hasUnsavedChanges ? (
                <Pressable
                  disabled={isSavingDraft}
                  onPress={handleSaveDraft}
                  style={customizeStyles.headerButton}
                >
                  {isSavingDraft ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.textSecondary}
                    />
                  ) : (
                    <Text
                      style={[
                        customizeStyles.headerButtonText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Save
                    </Text>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                disabled={isPublishing || !config}
                onPress={handlePublish}
                style={[
                  customizeStyles.publishButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                {isPublishing ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.textOnPrimary}
                  />
                ) : (
                  <Text
                    style={[
                      customizeStyles.publishButtonText,
                      { color: colors.textOnPrimary },
                    ]}
                  >
                    Publish
                  </Text>
                )}
              </Pressable>
            </View>
          ),
        }}
      />

      <CustomizeViewModeToggle
        colors={colors}
        onChange={setViewMode}
        value={viewMode}
      />

      {viewMode === 'chat' ? (
        <CustomizeChatPanel
          colors={colors}
          flatListRef={flatListRef}
          inputText={inputText}
          isProcessingAI={isProcessingAI}
          messages={messages}
          onInputTextChange={setInputText}
          onSend={handleSend}
          onSuggestionSelect={setInputText}
          shadowStyle={shadows.md}
        />
      ) : (
        <CustomizePreviewSwitch
          colors={colors}
          config={config}
          previewKey={previewKey}
        />
      )}
    </SafeAreaView>
  );
}
