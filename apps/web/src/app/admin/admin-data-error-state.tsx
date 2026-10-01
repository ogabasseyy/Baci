import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface AdminDataErrorStateProps {
  message: string;
  onRetry: () => void;
  retrying: boolean;
  title: string;
}

export function AdminDataErrorState({
  message,
  onRetry,
  retrying,
  title,
}: AdminDataErrorStateProps) {
  return (
    <Card className="border-destructive/30" role="alert">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle
            className="size-5 text-destructive"
            aria-hidden="true"
          />
          {title}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onRetry} disabled={retrying} variant="outline">
          <RefreshCw
            className={`mr-2 size-4 ${retrying ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden="true"
          />
          {retrying ? 'Retrying…' : 'Try again'}
        </Button>
      </CardContent>
    </Card>
  );
}
