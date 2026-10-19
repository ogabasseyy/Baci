'use client';

import { ArrowLeft, Loader2, LogOut, Mail, Phone, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { asRoute } from '@/lib/routes';

export default function CustomerSettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { loading: merchantLoading } = useMerchant();
  const {
    customer,
    isAuthenticated,
    isLoading: authLoading,
    logout,
    updateCustomer,
  } = useCustomerAuth();
  const { currencySymbol } = useCurrency();

  const [fullName, setFullName] = useState(() =>
    customer
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : ''
  );
  const [phone, setPhone] = useState(() => customer?.phone || '');
  const [isSaving, setIsSaving] = useState(false);
  const [prevCustomer, setPrevCustomer] = useState(customer);

  // Sync form fields inline during render when the customer record changes
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  if (customer !== prevCustomer) {
    setPrevCustomer(customer);
    if (customer) {
      setFullName(
        `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      );
      setPhone(customer.phone || '');
    }
  }

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      const redirectPath = asRoute('/account/settings');
      router.push(
        asRoute(`/account/login?redirect=${encodeURIComponent(redirectPath)}`)
      );
    }
  }, [authLoading, isAuthenticated, router]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    updateCustomer({
      first_name: fullName.split(' ')[0] || '',
      last_name: fullName.split(' ').slice(1).join(' ') || '',
      phone: phone || undefined,
    })
      .then((result) => {
        if (result.success) {
          toast({
            title: 'Settings saved',
            description: 'Your profile has been updated.',
          });
        } else {
          toast({
            title: 'Error',
            description: result.error || 'Failed to save settings',
            variant: 'destructive',
          });
        }
      })
      .catch((error) => {
        console.error('Failed to update customer settings:', error);
        toast({
          title: 'Error',
          description: 'An unexpected error occurred. Please try again.',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push(asRoute('/'));
    } catch {
      toast({
        title: 'Could not sign out',
        description: 'Please reconnect and try again.',
        variant: 'destructive',
      });
    }
  };

  if (merchantLoading || authLoading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <Skeleton className="h-8 w-48 mb-8" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !customer) {
    return null;
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center">
          <Link
            href={asRoute('/account')}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span>Back to account</span>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Account Settings</h1>
          <p className="text-muted-foreground">
            Manage your profile and preferences
          </p>
        </div>

        <div className="space-y-6">
          {/* Profile Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="size-5" />
                Profile Information
              </CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    placeholder="Your name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={customer.email}
                      className="pl-10 bg-muted/50"
                      disabled
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Email cannot be changed. Contact support if you need to
                    update it.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <Button type="submit" disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Account Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Account Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Member Since
                  </dt>
                  <dd className="text-lg font-medium">
                    {customer.created_at
                      ? new Date(customer.created_at).toLocaleDateString(
                          undefined,
                          {
                            month: 'long',
                            year: 'numeric',
                          }
                        )
                      : 'N/A'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Total Orders
                  </dt>
                  <dd className="text-lg font-medium">
                    {customer.total_orders || 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Total Spent</dt>
                  <dd className="text-lg font-medium">
                    {currencySymbol}
                    {(customer.total_spent || 0).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Store Credit
                  </dt>
                  <dd className="text-lg font-medium">
                    {currencySymbol}
                    {(customer.store_credit || 0).toLocaleString()}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-lg text-destructive">
                Sign Out
              </CardTitle>
              <CardDescription>
                Sign out of your account on this device
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={handleLogout}>
                <LogOut className="size-4 mr-2" />
                Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
