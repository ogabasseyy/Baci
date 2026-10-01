import {
  buildMailtoLink,
  buildTelLink,
  buildWhatsAppLink,
  normalizeNegotiationCustomerEmail,
} from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { palette } from '@/constants/Colors';
import type {
  NegotiationCardColors,
  NegotiationCardRequest,
} from './NegotiationCard';
import { negotiationCardStyles as styles } from './NegotiationCard.styles';

interface NegotiationContactActionsProps {
  colors: NegotiationCardColors;
  item: NegotiationCardRequest;
  onOpenExternalUrl: (url: string) => void | Promise<void>;
}

function buildFollowUpMessage(request: NegotiationCardRequest): string {
  const item = request.item_info?.name ?? 'your cart';
  return `Hi! About your negotiation offer on ${item} — `;
}

function buildFollowUpSubject(request: NegotiationCardRequest): string {
  const item = request.item_info?.name ?? 'your cart';
  return `Negotiation follow-up: ${item}`;
}

export function NegotiationContactActions({
  colors,
  item,
  onOpenExternalUrl,
}: NegotiationContactActionsProps) {
  const telLink = item.customer_phone
    ? buildTelLink(item.customer_phone)
    : null;
  const whatsAppLink = item.customer_phone
    ? buildWhatsAppLink(item.customer_phone, buildFollowUpMessage(item))
    : null;
  const customerEmail = normalizeNegotiationCustomerEmail(item.customer_email);
  const emailLink = customerEmail
    ? buildMailtoLink(
        customerEmail,
        buildFollowUpSubject(item),
        buildFollowUpMessage(item)
      )
    : null;
  const hasDeliveryChannel = Boolean(item.customer_id || telLink || emailLink);

  return (
    <>
      {customerEmail ? (
        <Text
          style={[styles.contactEmail, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {customerEmail}
        </Text>
      ) : null}

      {telLink || whatsAppLink || emailLink ? (
        <View style={styles.contactRow}>
          {telLink ? (
            <Pressable
              style={[
                styles.contactButton,
                styles.callButton,
                { borderColor: colors.border },
              ]}
              onPress={() => void onOpenExternalUrl(telLink)}
              accessibilityRole="button"
              accessibilityLabel="Call customer"
            >
              <Ionicons name="call" size={16} color={colors.text} />
              <Text style={[styles.callButtonText, { color: colors.text }]}>
                Call
              </Text>
            </Pressable>
          ) : null}
          {whatsAppLink ? (
            <Pressable
              style={[styles.contactButton, styles.whatsappButton]}
              onPress={() => void onOpenExternalUrl(whatsAppLink)}
              accessibilityRole="button"
              accessibilityLabel="Message customer on WhatsApp"
            >
              <Ionicons name="logo-whatsapp" size={16} color={palette.white} />
              <Text style={styles.whatsappButtonText}>WhatsApp</Text>
            </Pressable>
          ) : null}
          {emailLink ? (
            <Pressable
              style={[
                styles.contactButton,
                styles.emailButton,
                { borderColor: colors.border },
              ]}
              onPress={() => void onOpenExternalUrl(emailLink)}
              accessibilityRole="button"
              accessibilityLabel="Email customer"
            >
              <Ionicons name="mail-outline" size={16} color={colors.text} />
              <Text style={[styles.emailButtonText, { color: colors.text }]}>
                Email
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!hasDeliveryChannel ? (
        <View
          style={[
            styles.contactWarning,
            {
              backgroundColor: colors.warningLight,
              borderColor: colors.warning,
            },
          ]}
          accessibilityRole="text"
        >
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={[styles.contactWarningText, { color: colors.warning }]}>
            No delivery channel captured. The customer will not be notified when
            this request is resolved.
          </Text>
        </View>
      ) : null}
    </>
  );
}
