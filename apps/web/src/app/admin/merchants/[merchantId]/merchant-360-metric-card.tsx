import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function Merchant360MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <Card role="group" aria-label={`${label} summary`}>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="size-7 text-primary" aria-hidden="true" />
        <div>
          <p className="text-stat">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
