'use client';

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Rocket,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { SetupChecklistContent } from './setup-checklist-content';
import type { SetupChecklistContentProps } from './setup-checklist-types';

interface SetupChecklistDesktopCardProps extends SetupChecklistContentProps {
  dismissible: boolean;
  onDismiss: () => void;
  onPublish: () => void;
  publishing: boolean;
}

export function SetupChecklistDesktopCard({
  compact,
  dismissible,
  displayItems,
  incompleteItems,
  onDismiss,
  onPublish,
  publishing,
  readiness,
  requiredIncomplete,
  setShowAll,
  showAll,
}: SetupChecklistDesktopCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusLabel = readiness.isPublished
    ? 'Store is Live'
    : readiness.isReady
      ? 'Ready to Launch'
      : 'Store setup is pending';

  return (
    <Card
      className={cn(
        'relative hidden overflow-hidden md:block',
        compact && 'border-0 bg-transparent shadow-none',
        !readiness.isReady &&
          'border-amber-200 bg-amber-50/30 dark:border-amber-900/60 dark:bg-amber-950/20'
      )}
    >
      {dismissible && isExpanded && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-2 right-2 rounded-full p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Dismiss setup checklist"
        >
          <X className="size-4 text-muted-foreground" />
        </button>
      )}
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls="store-setup-checklist-details"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 pr-14 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-3">
          {readiness.isPublished ? (
            <CheckCircle2 className="size-5 shrink-0 text-green-600" />
          ) : readiness.isReady ? (
            <Rocket className="size-5 shrink-0 text-primary" />
          ) : (
            <AlertCircle className="size-5 shrink-0 text-amber-600" />
          )}
          <span className="min-w-0">
            <span className="block truncate font-semibold">{statusLabel}</span>
            <span className="block truncate text-sm text-muted-foreground">
              {readiness.overallProgress}% complete
              {requiredIncomplete.length > 0
                ? ` · ${requiredIncomplete.length} required ${requiredIncomplete.length === 1 ? 'item' : 'items'} remaining`
                : readiness.overallProgress === 100
                  ? ' · Setup complete'
                  : ' · Required setup complete'}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-5 shrink-0 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      <div
        id="store-setup-checklist-details"
        aria-hidden={!isExpanded}
        inert={!isExpanded ? true : undefined}
        className={cn(
          'border-t transition-[max-height,opacity] duration-200',
          !isExpanded && 'pointer-events-none max-h-0 overflow-hidden opacity-0'
        )}
      >
        <CardHeader className={cn(compact && 'px-0 pt-0')}>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                {readiness.isPublished ? (
                  <>
                    <CheckCircle2 className="size-5 text-green-600" />
                    Store is Live
                  </>
                ) : readiness.isReady ? (
                  <>
                    <Rocket className="size-5 text-primary" />
                    Ready to Launch
                  </>
                ) : (
                  <>
                    <AlertCircle className="size-5 text-amber-600" />
                    Complete Your Store Setup
                  </>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                {readiness.isPublished
                  ? `${readiness.overallProgress}% complete - Keep improving your store`
                  : readiness.isReady
                    ? 'All required items complete. Publish your store to start selling!'
                    : `${readiness.completedRequired}/${readiness.totalRequired} required items complete`}
              </CardDescription>
            </div>
            {!readiness.isPublished && readiness.isReady && (
              <Button
                onClick={onPublish}
                disabled={publishing}
                className="shrink-0"
              >
                {publishing ? (
                  <div className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Rocket className="mr-2 size-4" />
                )}
                Publish Store
              </Button>
            )}
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Setup Progress</span>
              <span className="font-medium">{readiness.overallProgress}%</span>
            </div>
            <Progress
              value={readiness.overallProgress}
              className="h-2"
              aria-label="Setup progress"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <SetupChecklistContent
            compact={compact}
            displayItems={displayItems}
            incompleteItems={incompleteItems}
            readiness={readiness}
            requiredIncomplete={requiredIncomplete}
            setShowAll={setShowAll}
            showAll={showAll}
          />
        </CardContent>
      </div>
    </Card>
  );
}
