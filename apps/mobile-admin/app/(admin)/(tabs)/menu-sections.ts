import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';
import type { MobileFeatureGate } from '@/lib/feature-gates';
import { createExpenseMenuItem } from './expense-menu-item';

export interface MenuItem {
  id: string;
  icon: IoniconsIconName;
  label: string;
  description?: string;
  onPress: () => void;
  iconColor?: string;
  badge?: string;
  destructive?: boolean;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

interface CreateMenuSectionsOptions {
  canCreateExpenses: boolean;
  canManageIntegrations: boolean;
  canViewExpenses: boolean;
  destructiveColor: string;
  isMerchantOwner: boolean;
  isPaystackSettlementCountry: boolean;
  onFeaturePress: (
    feature: MobileFeatureGate,
    label: string,
    pathname: string
  ) => void;
  onLogout: () => void;
  onNavigate: (pathname: string) => void;
  proBadge: (feature: MobileFeatureGate) => string | undefined;
}

export function createMenuSections({
  canCreateExpenses,
  canManageIntegrations,
  canViewExpenses,
  destructiveColor,
  isMerchantOwner,
  isPaystackSettlementCountry,
  onFeaturePress,
  onLogout,
  onNavigate,
  proBadge,
}: CreateMenuSectionsOptions): MenuSection[] {
  const expenseMenuItem = createExpenseMenuItem(
    canViewExpenses,
    () => onNavigate('/expenses'),
    canCreateExpenses,
    () => onNavigate('/expenses/new')
  );
  const payoutSettingsItem =
    isPaystackSettlementCountry && canManageIntegrations
      ? {
          id: 'payout-settings',
          icon: 'cash-outline' as IoniconsIconName,
          label: 'Payout Settings',
          description: 'Change the bank account used for payouts',
          onPress: () => onNavigate('/payout-settings'),
        }
      : null;
  const emailDomainItem = isMerchantOwner
    ? {
        id: 'email-domain',
        icon: 'mail-outline' as IoniconsIconName,
        label: 'Email Domain',
        description: 'Send store emails from your own domain',
        badge: proBadge('custom_email_domain'),
        onPress: () =>
          onFeaturePress(
            'custom_email_domain',
            'Email Domain',
            '/email-domain-settings'
          ),
      }
    : null;

  return [
    {
      title: 'Store',
      items: [
        {
          id: 'customize',
          icon: 'color-palette-outline',
          label: 'Customize Website',
          description: 'Colors, theme, and branding',
          onPress: () => onNavigate('/customize'),
        },
        {
          id: 'store-settings',
          icon: 'storefront-outline',
          label: 'Store Settings',
          description: 'Name, logo, and store details',
          onPress: () => onNavigate('/store-settings'),
        },
        {
          id: 'social-media',
          icon: 'share-social-outline',
          label: 'Social Media',
          description: 'Instagram, TikTok, X, Snapchat, Linkedin',
          onPress: () => onNavigate('/social-media'),
        },
        {
          id: 'marketplaces',
          icon: 'cart-outline',
          label: 'Marketplaces',
          description: 'Connect Jumia, Konga, etc.',
          badge: proBadge('marketplace_sync'),
          onPress: () =>
            onFeaturePress(
              'marketplace_sync',
              'Marketplaces',
              '/sales-channels'
            ),
        },
        {
          id: 'payments',
          icon: 'card-outline',
          label: 'Payment Methods',
          description: 'Configure payment options',
          onPress: () => onNavigate('/payment-methods'),
        },
        ...(payoutSettingsItem ? [payoutSettingsItem] : []),
        {
          id: 'staff-accounts',
          icon: 'wallet-outline',
          label: 'Staff Accounts',
          description: 'Payment accounts for staff & branches',
          onPress: () => onNavigate('/staff-accounts'),
        },
        {
          id: 'shipping',
          icon: 'car-outline',
          label: 'Shipping',
          description: 'Delivery zones and rates',
          onPress: () => onNavigate('/shipping'),
        },
        {
          id: 'tax',
          icon: 'receipt-outline',
          label: 'Tax',
          description: 'VAT settings',
          onPress: () => onNavigate('/tax'),
        },
        {
          id: 'domains',
          icon: 'globe-outline',
          label: 'Domains',
          description: 'Custom domain settings',
          badge: proBadge('custom_domain'),
          onPress: () => onFeaturePress('custom_domain', 'Domains', '/domains'),
        },
      ],
    },
    {
      title: 'Business',
      items: [
        {
          id: 'analytics',
          icon: 'analytics-outline',
          label: 'Analytics',
          description: 'Sales and traffic insights',
          onPress: () => onNavigate('/analytics'),
        },
        {
          id: 'transactions',
          icon: 'cash-outline',
          label: 'Transactions',
          description: 'Review paid sales and update cost prices',
          onPress: () => onNavigate('/transactions'),
        },
        {
          id: 'growth-marketing',
          icon: 'rocket-outline',
          label: 'Growth & Marketing',
          description: 'Pixels, CAPI, Setup',
          badge: proBadge('growth_integrations'),
          onPress: () =>
            onFeaturePress(
              'growth_integrations',
              'Growth & Marketing',
              '/analytics-config'
            ),
        },
        ...(emailDomainItem ? [emailDomainItem] : []),
        ...(expenseMenuItem ? [expenseMenuItem] : []),
        {
          id: 'discounts',
          icon: 'pricetag-outline',
          label: 'Discounts',
          description: 'Coupons and promotions',
          onPress: () => onNavigate('/discounts'),
        },
        {
          id: 'negotiations',
          icon: 'chatbubbles-outline',
          label: 'Negotiation Requests',
          description: 'Manage price negotiation requests',
          onPress: () => onNavigate('/(admin)/negotiations'),
        },
        {
          id: 'repairs',
          icon: 'construct-outline',
          label: 'Repair Bookings',
          description: 'Manage repair service requests',
          onPress: () => onNavigate('/(admin)/repairs'),
        },
        {
          id: 'staff',
          icon: 'people-outline',
          label: 'Staff',
          description: 'Team members and permissions',
          onPress: () => onNavigate('/staff'),
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          id: 'help',
          icon: 'help-circle-outline',
          label: 'Help Center',
          onPress: () => onNavigate('/help'),
        },
        {
          id: 'contact',
          icon: 'chatbubble-outline',
          label: 'Contact Support',
          onPress: () => onNavigate('/contact-support'),
        },
        {
          id: 'feedback',
          icon: 'star-outline',
          label: 'Send Feedback',
          onPress: () => onNavigate('/send-feedback'),
        },
      ],
    },
    {
      title: 'Account',
      items: [
        {
          id: 'profile',
          icon: 'person-outline',
          label: 'Profile',
          description: 'Your account details',
          onPress: () => onNavigate('/(admin)/profile'),
        },
        ...(isPaystackSettlementCountry
          ? [
              {
                id: 'kyc',
                icon: 'shield-checkmark-outline' as IoniconsIconName,
                label: 'Identity Verification',
                description: 'Manage NIN, BVN, and CAC verification',
                onPress: () => onNavigate('/kyc'),
              },
            ]
          : []),
        {
          id: 'security',
          icon: 'lock-closed-outline',
          label: 'Security',
          description: 'Password and two-factor authentication',
          onPress: () => onNavigate('/(admin)/security'),
        },
        {
          id: 'notifications',
          icon: 'notifications-outline',
          label: 'Notifications',
          description: 'Push notification settings',
          onPress: () => onNavigate('/(admin)/notifications'),
        },
        {
          id: 'logout',
          icon: 'log-out-outline',
          label: 'Log Out',
          onPress: onLogout,
          iconColor: destructiveColor,
          destructive: true,
        },
      ],
    },
  ];
}
