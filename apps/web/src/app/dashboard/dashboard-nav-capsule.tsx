'use client';

import { ChevronUp, MoreHorizontal, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { BagIcon } from '@/components/bag-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { DashboardNavItem } from './client-layout';

const COMPACT_ITEM_IDS = [
  'dashboard',
  'analytics',
  'orders',
  'products',
  'customers',
] as const;

interface DashboardNavCapsuleProps {
  expanded: boolean;
  items: DashboardNavItem[];
  pathname: string;
  onExpandedChange: (expanded: boolean) => void;
  onNavigate: (itemId: string) => void;
  onUpgrade?: () => void;
}

function isItemActive(item: DashboardNavItem, pathname: string): boolean {
  return (
    pathname === item.href ||
    (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)) ||
    (item.children?.some((child) => pathname === child.href) ?? false)
  );
}

export function DashboardNavCapsule({
  expanded,
  items,
  pathname,
  onExpandedChange,
  onNavigate,
  onUpgrade,
}: DashboardNavCapsuleProps) {
  const capsuleRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const visibleItems = expanded
    ? items
    : COMPACT_ITEM_IDS.flatMap((id) => {
        const item = items.find((candidate) => candidate.id === id);
        return item ? [item] : [];
      });

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!capsuleRef.current?.contains(event.target as Node)) {
        onExpandedChange(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onExpandedChange(false);
        toggleRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [expanded, onExpandedChange]);

  useEffect(() => {
    if (!expanded) return;
    const firstExpandedLink =
      capsuleRef.current?.querySelector<HTMLAnchorElement>(
        'nav a[href]:not([href="/dashboard"] )'
      );
    firstExpandedLink?.focus();
  }, [expanded]);

  return (
    <aside
      ref={capsuleRef}
      aria-label="Quick navigation"
      className="fixed left-4 top-1/2 z-30 hidden -translate-y-1/2 md:block"
    >
      <TooltipProvider delayDuration={120}>
        <div
          className={cn(
            'relative flex w-[68px] flex-col items-center rounded-[28px] border border-white/25 bg-background/72 p-2.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-[max-height,box-shadow] duration-300 dark:border-white/10 dark:bg-black/45',
            'max-h-[calc(100vh-32px)]'
          )}
        >
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-linear-to-r from-transparent via-white/80 to-transparent" />
          <Link
            href="/dashboard"
            aria-label="Baci dashboard"
            onClick={() => onNavigate('dashboard')}
            className="mb-2 grid size-11 shrink-0 place-items-center rounded-full border border-border/60 bg-background/70 shadow-sm transition-transform hover:scale-105"
          >
            <BagIcon width={25} height={25} />
          </Link>
          <div className="mb-1 h-px w-7 shrink-0 bg-border/70" />

          <nav
            aria-label={expanded ? 'All navigation' : 'Navigation shortcuts'}
            className="custom-scrollbar grid min-h-0 gap-1.5 overflow-y-auto overflow-x-hidden py-1"
          >
            {visibleItems.map((item) => {
              const isActive = isItemActive(item, pathname);
              return (
                <div key={item.id} className="grid gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        aria-label={`${item.label}${item.badge ? `, ${item.badge > 99 ? '99+' : item.badge}` : ''}`}
                        aria-current={
                          pathname === item.href ? 'page' : undefined
                        }
                        onClick={() => onNavigate(item.id)}
                        className={cn(
                          'group relative grid size-11 place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-foreground',
                          isActive &&
                            'bg-primary text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.75)] hover:bg-primary hover:text-primary-foreground'
                        )}
                      >
                        <item.icon className="size-5 transition-transform duration-200 group-hover:scale-105" />
                        {item.badge ? (
                          <Badge className="absolute -right-1 -top-1 min-w-4 rounded-full bg-amber-400 px-1 text-[9px] leading-4 text-amber-950 shadow-sm hover:bg-amber-400">
                            {item.badge > 99 ? '99+' : item.badge}
                          </Badge>
                        ) : null}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>

                  {expanded &&
                    item.children?.map((child) => (
                      <Tooltip key={child.id}>
                        <TooltipTrigger asChild>
                          <Link
                            href={child.href}
                            aria-label={child.label}
                            aria-current={
                              pathname === child.href ? 'page' : undefined
                            }
                            onClick={() => onNavigate(child.id)}
                            className={cn(
                              'relative grid size-9 place-items-center justify-self-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                              pathname === child.href &&
                                'bg-primary/15 text-primary ring-1 ring-primary/20'
                            )}
                          >
                            <child.icon className="size-4" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {child.label}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                </div>
              );
            })}
          </nav>

          <div className="mt-1 h-px w-7 shrink-0 bg-border/70" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={toggleRef}
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onExpandedChange(!expanded)}
                className="mt-1 size-11 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={
                  expanded
                    ? 'Show fewer navigation items'
                    : 'Show all navigation'
                }
                aria-expanded={expanded}
              >
                {expanded ? (
                  <ChevronUp className="size-5" />
                ) : (
                  <MoreHorizontal className="size-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {expanded ? 'Show fewer' : 'Show all navigation'}
            </TooltipContent>
          </Tooltip>
          {onUpgrade ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onUpgrade}
                  className="mt-1 size-11 shrink-0 rounded-full text-amber-600 hover:bg-amber-500/10"
                  aria-label="Upgrade plan"
                >
                  <Rocket className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Upgrade plan</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TooltipProvider>
    </aside>
  );
}
