import { LogOut, Package, Settings, User } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { asRoute } from '@/lib/routes';
import type { CustomerSession } from './use-customer-session';

/**
 * Desktop customer-account control (extracted from Header): the signed-in
 * dropdown, or the sign-in button. Rendered markup is unchanged.
 */
export function HeaderAccountMenu({
  customerSession,
  getHref,
  onLogout,
}: {
  customerSession: CustomerSession | null;
  getHref: (path: string) => string;
  onLogout: () => void;
}) {
  if (customerSession?.authenticated && customerSession.customer) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="User account"
            className="p-2 hover:bg-black/5 rounded-full transition-colors group hidden sm:block"
          >
            <User className="size-5 group-hover:scale-110 transition-transform" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-y-1">
              <p className="text-sm font-medium leading-none">
                {[
                  customerSession.customer.first_name,
                  customerSession.customer.last_name,
                ]
                  .filter(Boolean)
                  .join(' ') || 'Customer'}
              </p>
              <p className="text-xs leading-none text-muted-foreground">
                {customerSession.customer.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              href={asRoute(getHref('/account'))}
              className="cursor-pointer"
            >
              <User className="mr-2 size-4" />
              My Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              href={asRoute(getHref('/account/orders'))}
              className="cursor-pointer"
            >
              <Package className="mr-2 size-4" />
              Orders
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              href={asRoute(getHref('/account/settings'))}
              className="cursor-pointer"
            >
              <Settings className="mr-2 size-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onLogout}
            className="cursor-pointer text-destructive focus:bg-destructive focus:text-destructive-foreground"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
      <Link href={asRoute(getHref('/account/login'))}>Sign in</Link>
    </Button>
  );
}
