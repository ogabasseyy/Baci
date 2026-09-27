import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';

interface ReceiptPreviewModalProps {
  visible: boolean;
  html: string;
  onClose: () => void;
  onDismissed?: () => void;
  isPaid: boolean;
  // Whether the document is a paid receipt, an unpaid invoice, or a proforma.
  // Controls the title/share labels independently of `isPaid` (which only
  // drives the accent), because a utility record is always a "receipt"
  // regardless of vend status.
  documentType?: 'receipt' | 'invoice' | 'proforma';
  // Plain-text fallback shared when PDF generation/sharing is unavailable.
  shareText?: string;
}

// Module-scope helper: dynamic import expressions and try/catch are not yet
// supported by React Compiler inside component bodies. Never rejects.
const shareReceiptPdf = async (
  html: string,
  documentType: 'receipt' | 'invoice' | 'proforma',
  shareText?: string
) => {
  const dialogTitle =
    documentType === 'proforma'
      ? 'Share Proforma Invoice'
      : documentType === 'invoice'
        ? 'Share Invoice'
        : 'Share Receipt';
  let pdfUri: string | null = null;
  try {
    // Dynamic import: avoids crash if native modules aren't linked yet
    // (requires dev client rebuild after adding expo-print/expo-sharing)
    const Print = await import('expo-print');
    const Sharing = await import('expo-sharing');

    const { uri } = await Print.printToFileAsync({ html });
    pdfUri = uri;
    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle,
      UTI: 'com.adobe.pdf',
    });
  } catch (err) {
    // User cancelled the share dialog — not an error
    if (
      err instanceof Error &&
      (err.message.includes('cancelled') || err.message.includes('canceled'))
    ) {
      return;
    }
    // PDF unavailable (expo-print/sharing missing or failed) — fall back to
    // sharing the receipt details as plain text so the customer can still share.
    if (shareText) {
      try {
        await Share.share({ message: shareText });
        return;
      } catch {
        // fall through to the alert below
      }
    }
    Alert.alert(
      'Share Failed',
      'Could not share the receipt. Please try again.'
    );
  } finally {
    // Remove the generated temp PDF so repeated shares don't leave cache files.
    if (pdfUri) {
      try {
        const FileSystem = await import('expo-file-system');
        await FileSystem.deleteAsync(pdfUri, { idempotent: true });
      } catch {
        // Best-effort cleanup; sharing must not fail on a temp-file delete.
      }
    }
  }
};

export function ReceiptPreviewModal({
  visible,
  html,
  onClose,
  onDismissed,
  isPaid,
  documentType,
  shareText,
}: ReceiptPreviewModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const [isSharing, setIsSharing] = useState(false);
  // Default the document label from paid status (preserves the devices/orders
  // invoice flow). Utility callers pass documentType='receipt' explicitly.
  const resolvedDocumentType = documentType ?? (isPaid ? 'receipt' : 'invoice');

  const handleShare = async () => {
    if (!html || isSharing) return;
    setIsSharing(true);
    await shareReceiptPdf(html, resolvedDocumentType, shareText);
    setIsSharing(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onDismiss={onDismissed}
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
              // Keep the header clear of the status bar / notch when the modal
              // presents fullscreen on iOS.
              paddingTop: Math.max(insets.top, 12),
            },
          ]}
        >
          <View style={styles.headerLeft}>
            <Pressable
              onPress={onClose}
              style={[styles.headerBtn, { backgroundColor: colors.muted }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {resolvedDocumentType === 'proforma'
              ? 'Proforma Invoice Preview'
              : resolvedDocumentType === 'invoice'
                ? 'Invoice Preview'
                : 'Receipt Preview'}
          </Text>
          <View style={styles.headerRight} />
        </View>

        {/* WebView Preview */}
        <View style={styles.webviewContainer}>
          {html ? (
            <WebView
              source={{ html }}
              style={styles.webview}
              scrollEnabled
              bounces={false}
              showsVerticalScrollIndicator={false}
              scalesPageToFit
              originWhitelist={['about:blank']}
              mixedContentMode="never"
              javaScriptEnabled={false}
            />
          ) : null}
        </View>

        {/* Bottom Action Bar */}
        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              borderTopColor: colors.border,
              backgroundColor: colors.card,
            },
          ]}
        >
          <Pressable
            onPress={handleShare}
            disabled={isSharing}
            style={[
              styles.shareBtn,
              {
                backgroundColor: isPaid ? '#059669' : BRAND.primary,
                opacity: isSharing ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Share as PDF"
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="share-outline" size={20} color="#FFF" />
            )}
            <Text style={styles.shareBtnText}>
              {isSharing ? 'Generating PDF...' : 'Share as PDF'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    width: 60,
    alignItems: 'flex-start',
  },
  headerRight: {
    width: 60,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  webviewContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  shareBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
