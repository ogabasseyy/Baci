'use client';

import {
  FileText,
  Heart,
  LogOut,
  MapPin,
  Package,
  Settings,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type Customer,
  useCustomerAuth,
} from '@/contexts/customer-auth-context';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { asRoute } from '@/lib/routes';

const accountLinks = [
  {
    href: '/account/orders',
    icon: Package,
    title: 'Orders',
    description: 'View and track your orders',
  },
  {
    href: '/account/addresses',
    icon: MapPin,
    title: 'Addresses',
    description: 'Manage your shipping addresses',
  },
  {
    // This intentionally stays outside /account/* so storefront nav and
    // account quick links resolve to the same canonical document archive.
    href: '/receipts',
    icon: FileText,
    title: 'Receipts & Invoices',
    description: 'Download your order documents',
  },
  {
    href: '/wishlist',
    icon: Heart,
    title: 'Wishlist',
    description: 'Products you saved for later',
  },
  {
    href: '/account/settings',
    icon: Settings,
    title: 'Settings',
    description: 'Update your profile and preferences',
  },
];

interface AccountPageClientProps {
  initialCustomer?: Customer | null;
}

export function AccountPageClient({
  initialCustomer = null,
}: AccountPageClientProps = {}) {
  const { toast } = useToast();
  const router = useRouter();
  const { merchant, loading: merchantLoading, basePath } = useMerchant();
  const {
    customer,
    isAuthenticated,
    isLoading: authLoading,
    logout,
  } = useCustomerAuth();
  const { currencySymbol } = useCurrency();
  const resolvedBasePath = basePath || '';
  const getHref = (path: string) => `${resolvedBasePath}${path}`;
  const displayCustomer =
    isAuthenticated && customer
      ? customer
      : authLoading
        ? initialCustomer
        : null;

  const handleLogout = async () => {
    try {
      await logout();
      router.push(asRoute(getHref('/')));
    } catch {
      toast({
        title: 'Could not sign out',
        description: 'Please reconnect and try again.',
        variant: 'destructive',
      });
    }
  };

  if (merchantLoading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <output aria-label="Loading account" className="sr-only">
            Loading account
          </output>
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!displayCustomer) {
    return (
      <main className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="mb-4 text-3xl font-bold">
            Sign in to view your account
          </h1>
          <p className="mb-8 text-muted-foreground">
            Access your orders, receipts, saved addresses and account
            preferences after signing in.
          </p>
          <Button asChild>
            <Link
              href={asRoute(
                `${resolvedBasePath}/account/login?redirect=${encodeURIComponent(
                  `${resolvedBasePath}/account`
                )}`
              )}
            >
              Sign in to your account
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href={asRoute(getHref('/'))} className="font-semibold text-lg">
            {merchant?.business_name || 'Store'}
          </Link>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="size-4 mr-2" />
            Sign out
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Welcome section */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="size-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                Welcome back, {displayCustomer.first_name || 'there'}!
              </h1>
              <p className="text-muted-foreground">{displayCustomer.email}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {displayCustomer.total_orders || 0}
                </p>
                <p className="text-sm text-muted-foreground">Orders</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {currencySymbol}
                  {(displayCustomer.total_spent || 0).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">Total Spent</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {currencySymbol}
                  {(displayCustomer.store_credit || 0).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">Store Credit</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {displayCustomer.saved_addresses?.length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Addresses</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick links */}
        <div className="grid gap-4 md:grid-cols-2">
          {accountLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={asRoute(getHref(link.href))}>
                <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardHeader className="flex flex-row items-center gap-4">
                    <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="size-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{link.title}</CardTitle>
                      <CardDescription>{link.description}</CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* Recent activity hint */}
        {(displayCustomer.total_orders || 0) === 0 && (
          <Card className="mt-8 bg-primary/5 border-primary/20">
            <CardContent className="p-6 text-center">
              <Package className="size-12 mx-auto mb-4 text-primary/60" />
              <h3 className="font-semibold mb-2">No orders yet</h3>
              <p className="text-muted-foreground mb-4">
                Start shopping and your orders will appear here
              </p>
              <Button asChild>
                <Link href={asRoute(getHref('/'))}>Browse Products</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
