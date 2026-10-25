import { Skeleton } from '@/components/ui/skeleton';

export function OxygenApplicationLoading() {
  return (
    <div
      role="status"
      aria-label="Preparing your application"
      className="grid gap-6 py-2"
    >
      <span className="sr-only">Preparing your application…</span>
      <div aria-hidden="true" className="grid gap-6">
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <Skeleton className="h-7 w-3/5" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
