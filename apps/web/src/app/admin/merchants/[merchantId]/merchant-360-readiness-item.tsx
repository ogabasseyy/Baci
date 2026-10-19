import { Badge } from '@/components/ui/badge';

export function Merchant360ReadinessItem({
  label,
  ready,
}: {
  label: string;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Badge variant={ready ? 'default' : 'secondary'}>
        {ready ? 'Ready' : 'Needs attention'}
      </Badge>
    </div>
  );
}
