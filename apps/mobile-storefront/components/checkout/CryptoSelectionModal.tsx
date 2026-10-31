import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import type { ScrollViewInstance } from 'react-native';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, palette, SPACING, withAlpha } from '@/constants/Colors';
import styles from './CryptoSelectionModal.styles';

type Stablecoin = 'USDT' | 'USDC';
type Network = 'TRX' | 'ETH' | 'MATIC' | 'AVAXC';

const CHAIN_SUPPORT: Record<Stablecoin, Network[]> = {
  USDT: ['TRX', 'ETH', 'MATIC', 'AVAXC'],
  USDC: ['ETH', 'MATIC', 'AVAXC'],
};

const NETWORK_INFO: Record<Network, { label: string; time: string }> = {
  TRX: { label: 'Tron', time: '1-3 min' },
  ETH: { label: 'Ethereum', time: '1-5 min' },
  MATIC: { label: 'Polygon', time: '1-5 min' },
  AVAXC: { label: 'Avalanche', time: '1-5 min' },
};

interface CryptoSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (chain: string, currency: string) => void;
  isProcessing: boolean;
}

export function CryptoSelectionModal({
  visible,
  onClose,
  onConfirm,
  isProcessing,
}: CryptoSelectionModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const networkScrollRef = useRef<ScrollViewInstance>(null);

  const [selectedCoin, setSelectedCoin] = useState<Stablecoin>('USDT');
  const [selectedNetwork, setSelectedNetwork] = useState<Network>('TRX');

  const availableNetworks = CHAIN_SUPPORT[selectedCoin];

  const handleCoinSelect = (coin: Stablecoin) => {
    setSelectedCoin(coin);
    const networks = CHAIN_SUPPORT[coin];
    if (!networks.includes(selectedNetwork)) {
      setSelectedNetwork(networks[0]);
    }
    networkScrollRef.current?.scrollTo({ x: 0, animated: true });
  };

  const handleConfirm = () => {
    onConfirm(selectedNetwork, selectedCoin);
  };

  const confirmationTime = NETWORK_INFO[selectedNetwork]?.time ?? '1-5 min';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: BRAND.primary }]}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="card-outline" size={20} color={palette.white} />
              <Text style={styles.headerTitle}>Select Crypto Payment</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
            >
              <Ionicons name="close" size={24} color={palette.white} />
            </Pressable>
          </View>

          <View style={styles.content}>
            {/* Stablecoin Selection */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              Select Stablecoin
            </Text>
            <View style={styles.optionsRow}>
              {(['USDT', 'USDC'] as Stablecoin[]).map((coin) => (
                <Pressable
                  key={coin}
                  onPress={() => handleCoinSelect(coin)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedCoin === coin }}
                  accessibilityLabel={`Select ${coin}`}
                  style={[
                    styles.optionCard,
                    {
                      borderColor:
                        selectedCoin === coin ? BRAND.primary : colors.border,
                      backgroundColor:
                        selectedCoin === coin
                          ? withAlpha(BRAND.primary, 0.06)
                          : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.optionTitle, { color: colors.text }]}>
                    {coin}
                  </Text>
                  <Text
                    style={[
                      styles.optionSubtitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {coin === 'USDT' ? 'Tether USD' : 'USD Coin'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Network Selection — horizontal scroll */}
            <Text
              style={[
                styles.sectionLabel,
                { color: colors.text, marginTop: SPACING.lg },
              ]}
            >
              Select Network
            </Text>
            <View style={styles.networkContainer}>
              <ScrollView
                ref={networkScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.networkScroll}
              >
                {availableNetworks.map((network) => {
                  const info = NETWORK_INFO[network];
                  const isSelected = selectedNetwork === network;
                  return (
                    <Pressable
                      key={network}
                      onPress={() => setSelectedNetwork(network)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`Select ${network} network`}
                      style={[
                        styles.networkCard,
                        {
                          borderColor: isSelected
                            ? BRAND.primary
                            : colors.border,
                          backgroundColor: isSelected
                            ? withAlpha(BRAND.primary, 0.06)
                            : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={[styles.optionTitle, { color: colors.text }]}
                      >
                        {network}
                      </Text>
                      <Text
                        style={[
                          styles.optionSubtitle,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {info.label}
                      </Text>
                      <Text
                        style={[
                          styles.networkTime,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {info.time}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {availableNetworks.length > 3 && (
                <View
                  style={[styles.scrollHint, { backgroundColor: colors.card }]}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
              )}
            </View>

            {/* Info Box */}
            <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
              <Ionicons
                name="time-outline"
                size={20}
                color={colors.textSecondary}
              />
              <View style={styles.infoTextContainer}>
                <Text style={[styles.infoTitle, { color: colors.text }]}>
                  {confirmationTime}
                </Text>
                <Text
                  style={[styles.infoSubtitle, { color: colors.textSecondary }]}
                >
                  Expected confirmation time
                </Text>
              </View>
            </View>

            {/* Confirm Button */}
            <Pressable
              onPress={handleConfirm}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel={`Continue with ${selectedCoin} on ${selectedNetwork}`}
              accessibilityState={{ disabled: isProcessing }}
              style={[
                styles.confirmBtn,
                {
                  backgroundColor: BRAND.primary,
                  opacity: isProcessing ? 0.7 : 1,
                },
              ]}
            >
              {isProcessing ? (
                <ActivityIndicator color={palette.white} />
              ) : (
                <Text style={styles.confirmBtnText}>
                  Continue with {selectedCoin} on {selectedNetwork}
                </Text>
              )}
            </Pressable>

            <Text style={[styles.helperText, { color: colors.textSecondary }]}>
              You'll receive a wallet address to send your {selectedCoin}{' '}
              payment
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}
