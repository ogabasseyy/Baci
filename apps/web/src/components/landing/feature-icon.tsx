import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  BarChart,
  Bot,
  Building,
  Clock,
  Coins,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Gift,
  Globe,
  Handshake,
  KeyRound,
  Layout,
  Megaphone,
  MessageCircle,
  Package,
  Palette,
  PenTool,
  PiggyBank,
  Receipt,
  Rss,
  ScanBarcode,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Ticket,
  Truck,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import type { PlatformFeatureIconKey } from '@/config/platform-features';

const FEATURE_ICON_MAP: Record<PlatformFeatureIconKey, LucideIcon> = {
  sparkles: Sparkles,
  handshake: Handshake,
  ticket: Ticket,
  'credit-card': CreditCard,
  smartphone: Smartphone,
  bot: Bot,
  gift: Gift,
  'shopping-cart': ShoppingCart,
  'message-circle': MessageCircle,
  star: Star,
  wallet: Wallet,
  coins: Coins,
  send: Send,
  clock: Clock,
  'piggy-bank': PiggyBank,
  building: Building,
  zap: Zap,
  palette: Palette,
  layout: Layout,
  'file-spreadsheet': FileSpreadsheet,
  search: Search,
  users: Users,
  'scan-barcode': ScanBarcode,
  package: Package,
  receipt: Receipt,
  'file-text': FileText,
  'bar-chart': BarChart,
  truck: Truck,
  store: Store,
  megaphone: Megaphone,
  rss: Rss,
  'pen-tool': PenTool,
  globe: Globe,
  'arrow-up-right': ArrowUpRight,
  'shield-check': ShieldCheck,
  'key-round': KeyRound,
};

interface FeatureIconProps {
  name: PlatformFeatureIconKey;
  className?: string;
}

export function FeatureIcon({
  name,
  className = 'size-5 text-accent',
}: FeatureIconProps) {
  const Icon = FEATURE_ICON_MAP[name];
  return <Icon className={className} aria-hidden="true" />;
}
