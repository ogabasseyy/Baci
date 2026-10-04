'use client';

import { ChevronDown, Loader2, LogOut, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { COUNTRIES, type Country } from '@/lib/countries';
import { DashboardStoreLink } from './dashboard-store-link';

export function DashboardHeaderActions({
  merchantLoading,
  storeUrl,
  customDomain,
  selectedCountry,
  onSelectCountry,
  onSignOut,
}: {
  merchantLoading: boolean;
  storeUrl: string;
  customDomain?: string;
  selectedCountry: Country | null | undefined;
  onSelectCountry: (countryCode: string) => void;
  onSignOut: () => void;
}) {
  const router = useRouter();

  return (
    <div className="hidden md:flex w-full justify-end items-center gap-3 px-6 pt-6 pb-2 z-20 bg-background/50 backdrop-blur-xs sticky top-0">
      <div className="flex items-center gap-2 p-1.5 rounded-full bg-white/60 dark:bg-black/40 backdrop-blur-xl border border-white/20 shadow-sm ml-auto">
        <DashboardStoreLink
          isMobile={false}
          isCollapsed={false}
          merchantLoading={merchantLoading}
          storeUrl={storeUrl}
          customDomain={customDomain}
        />
        <div className="w-px h-4 bg-border/50" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 gap-2 hover:bg-white/50"
              aria-label="Select country"
            >
              {merchantLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : selectedCountry ? (
                <span className="text-lg leading-none">
                  {selectedCountry.flag}
                </span>
              ) : (
                '🌐'
              )}
              <ChevronDown className="size-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel>Select Country</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COUNTRIES.map((country) => (
              <DropdownMenuItem
                key={country.code}
                onSelect={() => onSelectCountry(country.code)}
              >
                <span className="mr-2 text-lg">{country.flag}</span>
                <span>{country.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-4 bg-border/50" />

        <ThemeToggle />
        <NotificationCenter />

        <div className="w-px h-4 bg-border/50" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-full hover:bg-white/50"
              aria-label="User menu"
            >
              <User className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push('/dashboard/settings')}
            >
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSignOut} className="text-red-500">
              <LogOut className="mr-2 size-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
