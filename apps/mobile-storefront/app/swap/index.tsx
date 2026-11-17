import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { SwapOverviewContent } from '@/components/swap/SwapOverviewContent';
import {
  type SwapModalStep,
  SwapTradeInModal,
} from '@/components/swap/SwapTradeInModal';
import { swapScreenStyles as styles } from '@/components/swap/swap-screen.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';
import { createLogger } from '@/lib/logger';
import { analyzeSwapDevice } from '@/lib/swap/analyze-swap-device';
import {
  SWAP_MAX_PHOTOS,
  type SwapMedia,
  type SwapPickedAsset,
  selectSwapMedia,
} from '@/lib/swap/select-swap-media';
import { buildSwapWhatsappUrl } from '@/lib/swap-utils';
import type { AIAnalysisResult } from '@/lib/validation';

let ImagePicker: typeof import('expo-image-picker') | null = null;

const loadNativeModules = async () => {
  if (Platform.OS === 'web') return;
  try {
    ImagePicker = await import('expo-image-picker');
  } catch (error) {
    console.debug('[SwapScreen] ImagePicker module load failed:', error);
  }
};

const imagePickerReady = loadNativeModules();

const log = createLogger('Swap');

type SelectedMedia = { media: SwapMedia; label: string };

export default function SwapScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [step, setStep] = useState<SwapModalStep>('upload');
  const [selected, setSelected] = useState<SelectedMedia | null>(null);
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const applyPicked = (assets: SwapPickedAsset[]) => {
    const selection = selectSwapMedia(assets);
    if (selection.ok) {
      setSelected({ media: selection.media, label: selection.label });
      setError(null);
    } else {
      setSelected(null);
      setError(selection.error);
    }
  };

  const pickMedia = async () => {
    await imagePickerReady;
    if (!ImagePicker) {
      Alert.alert(
        'Not Supported',
        'Photo and video selection is not supported on this platform.'
      );
      return;
    }

    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow access to your media library.'
        );
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: SWAP_MAX_PHOTOS,
        quality: 0.8,
      });

      if (!pickerResult.canceled && pickerResult.assets.length > 0) {
        applyPicked(pickerResult.assets);
      }
    } catch (pickerError) {
      log.error('Error picking photos or video:', pickerError);
      setError('Failed to select photos or video. Please try again.');
    }
  };

  const recordVideo = async () => {
    await imagePickerReady;
    if (!ImagePicker) {
      Alert.alert(
        'Not Supported',
        'Video recording is not supported on this platform.'
      );
      return;
    }

    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow camera access.');
        return;
      }

      const cameraResult = await ImagePicker.launchCameraAsync({
        mediaTypes: 'videos',
        quality: 0.8,
        videoMaxDuration: 15,
      });

      if (!cameraResult.canceled && cameraResult.assets.length > 0) {
        applyPicked(cameraResult.assets);
      }
    } catch (cameraError) {
      log.error('Error recording video:', cameraError);
      setError('Failed to record video. Please try again.');
    }
  };

  const startAnalysis = async () => {
    if (!selected || isAnalyzing) return;

    setIsAnalyzing(true);
    setStep('analyzing');
    setError(null);

    // analyzeSwapDevice never rejects, so the trailing state updates
    // always run (same semantics as a finally block).
    const outcome = await analyzeSwapDevice(selected.media);

    if (outcome.ok) {
      setResult(outcome.data);
      setStep('result');
    } else {
      setError(outcome.message);
      setStep('upload');
    }

    setIsAnalyzing(false);
  };

  const resetModal = () => {
    setStep('upload');
    setSelected(null);
    setResult(null);
    setError(null);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetModal();
  };

  const handleAcceptOffer = () => {
    if (!result) return;
    Linking.openURL(buildSwapWhatsappUrl(result, SUPPORT_WHATSAPP_PHONE));
    setIsModalOpen(false);
  };

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom', 'left', 'right']}
    >
      <Stack.Screen
        options={{
          title: 'Swap & Trade-in',
          headerLeft: () => (
            <Pressable onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <SwapOverviewContent
          colors={colors}
          onStartTradeIn={() => setIsModalOpen(true)}
        />
      </ScrollView>

      <SwapTradeInModal
        colors={colors}
        error={error}
        isAnalyzing={isAnalyzing}
        result={result}
        step={step}
        mediaLabel={selected?.label ?? null}
        visible={isModalOpen}
        onAcceptOffer={handleAcceptOffer}
        onClearMedia={() => {
          setSelected(null);
          setError(null);
        }}
        onClose={closeModal}
        onPickMedia={pickMedia}
        onRecordVideo={recordVideo}
        onReset={resetModal}
        onStartAnalysis={startAnalysis}
      />
    </StorefrontScreenShell>
  );
}
