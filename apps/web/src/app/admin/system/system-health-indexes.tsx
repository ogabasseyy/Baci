import { HardDrive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminSystemHealth } from '@/schemas/admin-system-health';

type SystemHealthIndexesProps = {
  indexRecommendations: AdminSystemHealth['indexRecommendations'];
  loading: boolean;
};

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'high') return <Badge variant="destructive">High</Badge>;
  if (priority === 'medium') return <Badge variant="secondary">Medium</Badge>;
  if (priority === 'low') return <Badge variant="outline">Low</Badge>;
  return <Badge variant="outline">{priority}</Badge>;
}

export function SystemHealthIndexes({
  indexRecommendations,
  loading,
}: SystemHealthIndexesProps) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Index Recommendations</CardTitle>
        <CardDescription>
          Suggested database indexes to improve performance
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : indexRecommendations.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Index</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Priority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {indexRecommendations.map((recommendation) => (
                  <TableRow
                    key={`${recommendation.table_name}-${recommendation.index_name}`}
                  >
                    <TableCell className="font-mono text-sm">
                      {recommendation.table_name}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {recommendation.index_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {recommendation.reason}
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={recommendation.priority} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <HardDrive
              className="mx-auto mb-4 size-12 opacity-50"
              aria-hidden="true"
            />
            <p className="font-medium">No index recommendations returned</p>
            <p className="text-sm">
              The check completed without recommending an index change.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
