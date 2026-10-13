import { AlertTriangle } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type SystemHealthMissingIndexesProps = {
  indexes: string[];
};

export function SystemHealthMissingIndexes({
  indexes,
}: SystemHealthMissingIndexesProps) {
  if (indexes.length === 0) return null;

  return (
    <Card className="border-amber-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-amber-500" aria-hidden="true" />
          Missing Indexes
        </CardTitle>
        <CardDescription>
          These indexes should be created for better performance
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {indexes.map((indexName) => (
            <div
              key={indexName}
              className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
            >
              <code className="font-mono text-sm">{indexName}</code>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
