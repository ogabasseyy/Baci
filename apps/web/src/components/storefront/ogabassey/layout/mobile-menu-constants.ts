import type React from 'react';
import {
  Crown,
  FileText,
  Heart,
  HelpCircle,
  Home,
  LayoutGrid,
  MapPin,
  MessageSquare,
  Newspaper,
  Package,
  RefreshCw,
  ScanBarcode,
  ShoppingBag,
  Star,
  User,
  Wallet,
  Wrench,
} from 'lucide-react';

export interface MobileMenuItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

export const KNOWN_TOP_LEVEL_ROUTES = new Set([
  'about',
  'account',
  'blog',
  'cart',
  'checkout',
  'contact',
  'faq',
  'imei-check',
  'member-status',
  'pages',
  'privacy',
  'products',
  'receipts',
  'repairs',
  'reviews',
  'swap',
  'terms',
  'track-order',
  'wallet',
  'wishlist',
]);

export const MOBILE_MENU_SHOP_ITEMS: MobileMenuItem[] = [
  { label: 'Home', icon: Home, path: '/' },
  { label: 'All Products', icon: LayoutGrid, path: '/products' },
  { label: 'Swap / Trade-in', icon: RefreshCw, path: '/swap' },
  { label: 'IMEI Checker', icon: ScanBarcode, path: '/imei-check' },
  { label: 'Repairs', icon: Wrench, path: '/repairs' },
  { label: 'Blog', icon: Newspaper, path: '/blog' },
];

export const MOBILE_MENU_ACCOUNT_ITEMS: MobileMenuItem[] = [
  { label: 'My Account', icon: User, path: '/account' },
  { label: 'Wallet', icon: Wallet, path: '/wallet' },
  { label: 'Saved Items', icon: Heart, path: '/wishlist' },
  { label: 'Orders', icon: ShoppingBag, path: '/account/orders' },
  { label: 'Member Status', icon: Crown, path: '/member-status' },
  { label: 'Receipts', icon: FileText, path: '/receipts' },
  { label: 'Address Book', icon: MapPin, path: '/account/addresses' },
  { label: 'My Reviews', icon: Star, path: '/reviews' },
];

export const MOBILE_MENU_SUPPORT_ITEMS: MobileMenuItem[] = [
  { label: 'Track Order', icon: Package, path: '/track-order' },
  { label: 'Help & Support', icon: HelpCircle, path: '/faq' },
  { label: 'Contact Us', icon: MessageSquare, path: '/contact' },
];
