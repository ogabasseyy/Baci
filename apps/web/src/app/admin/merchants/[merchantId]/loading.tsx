import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const SUMMARY_SKELETON_COUNT = 4;
const DIRECTORY_SKELETON_COUNT = 3;
const DIRECTORY_ROW_SKELETON_COUNT = 3;

export default function Merchant360Loading() {
  return (
    <div
      aria-label="Loading merchant operations"
      className="block space-y-6"
      role="status"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: SUMMARY_SKELETON_COUNT }).map((_, index) => (
          <Card
            // biome-ignore lint/suspicious/noArrayIndexKey: Loading cards are static placeholders.
            key={index}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="size-8 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-10" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {Array.from({ length: DIRECTORY_SKELETON_COUNT }).map((_, cardIndex) => (
        <Card
          // biome-ignore lint/suspicious/noArrayIndexKey: Loading sections are static placeholders.
          key={cardIndex}
        >
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3 rounded-md border p-4">
              {Array.from({ length: DIRECTORY_ROW_SKELETON_COUNT }).map(
                (_, rowIndex) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: Loading rows are static placeholders.
                    key={rowIndex}
                    className="flex items-center gap-4"
                  >
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-36" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-24" />
                  </div>
                )
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
