import { OGABASSEY_RETURN_SUMMARY } from '@baci/shared';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import {
  type FAQItem,
  FAQView,
  type StoreInfo,
  type SupportOption,
} from '@/components/faq/FAQView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, withAlpha } from '@/constants/Colors';
import { SUPPORT_PHONE, SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';
import { CONFIG } from '@/lib/config';

const WHATSAPP_GREEN = '#25D366';
const storeInfo: StoreInfo = {
  address: 'Computer Village, Ikeja, Lagos',
  hours: ['Monday - Saturday: 9:00 AM - 7:00 PM', 'Sunday: 12:00 PM - 5:00 PM'],
};
const faqItems: FAQItem[] = [
  {
    id: '1',
    question: 'How do I track my order?',
    answer:
      'You can track your order by going to "Orders" in the menu. Each order has a status indicator and tracking information when available. You\'ll also receive SMS and email updates as your order progresses.',
  },
  {
    id: '2',
    question: 'What payment methods do you accept?',
    answer:
      'We accept multiple payment methods including card payments via Paystack, bank transfers, and Pay on Delivery. We also offer Buy Now Pay Later options through Credit Direct for eligible orders.',
  },
  {
    id: '3',
    question: 'How long does delivery take?',
    answer:
      'Delivery times vary based on your location. Lagos deliveries typically take 1-2 business days, while other states take 2-5 business days. Same-day delivery is available for select areas within Lagos.',
  },
  {
    id: '4',
    question: 'Can I return or exchange an item?',
    answer:
      'Yes! We offer a 7-day return policy for most items. The product must be in its original condition with all accessories. Contact our support team to initiate a return or exchange.',
  },
  {
    id: '5',
    question: "How do I verify a phone's IMEI?",
    answer:
      "Use our IMEI Checker feature in the app. Enter the 15-digit IMEI number to check if the device is blacklisted, iCloud locked, or has any other issues. This helps ensure you're buying a legitimate device.",
  },
  {
    id: '6',
    question: 'What is the Swap/Trade-in program?',
    answer:
      'Our trade-in program lets you exchange your old device for credit towards a new purchase. Simply upload a video of your device, and our AI will provide an instant valuation. Contact us via WhatsApp to complete the swap.',
  },
  {
    id: '7',
    question: 'Are your products genuine?',
    answer:
      'Yes, all our products are 100% authentic. We source directly from authorized distributors and offer warranty on all new devices. Pre-owned devices are thoroughly tested and verified.',
  },
];

const openSupportLink = (url: string): void => {
  void Linking.openURL(url).catch(() =>
    Alert.alert('Unable to Open', 'Please try again later')
  );
};

export default function FAQScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const supportOptions: SupportOption[] = [
    {
      id: 'whatsapp',
      title: 'WhatsApp Support',
      subtitle: 'Chat with us directly',
      icon: 'logo-whatsapp',
      iconBackgroundColor: WHATSAPP_GREEN,
      iconColor: BRAND.onPrimary,
      action: () => {
        openSupportLink(
          `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent('Hi, I need help with my order')}`
        );
      },
    },
    {
      id: 'call',
      title: 'Call Us',
      subtitle: SUPPORT_PHONE,
      icon: 'call-outline',
      iconBackgroundColor: withAlpha(BRAND.primary, 0.08),
      iconColor: BRAND.primary,
      action: () => {
        openSupportLink(`tel:+234${SUPPORT_PHONE.slice(1)}`);
      },
    },
    {
      id: 'email',
      title: 'Email Support',
      subtitle: 'support@ogabassey.com',
      icon: 'mail-outline',
      iconBackgroundColor: withAlpha(BRAND.primary, 0.08),
      iconColor: BRAND.primary,
      action: () => {
        openSupportLink('mailto:support@ogabassey.com');
      },
    },
  ];

  const toggleExpand = (id: string) => {
    setExpandedId((currentId) => (currentId === id ? null : id));
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Help & Support',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <FAQView
        colors={colors}
        expandedId={expandedId}
        faqItems={
          CONFIG.MERCHANT_SLUG === 'ogabassey'
            ? faqItems.map((item) =>
                item.id === '4'
                  ? {
                      ...item,
                      answer: OGABASSEY_RETURN_SUMMARY,
                    }
                  : item
              )
            : faqItems
        }
        onToggleExpand={toggleExpand}
        storeInfo={storeInfo}
        supportOptions={supportOptions}
      />
    </>
  );
}
