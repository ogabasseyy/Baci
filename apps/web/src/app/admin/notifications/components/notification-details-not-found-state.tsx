import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function NotificationDetailsNotFoundState() {
  return (
    <div className="text-center py-12">
      <Bell className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
      <h2 className="text-xl font-semibold mb-2">Notification Not Found</h2>
      <p className="text-muted-foreground mb-4">
        The notification you're looking for doesn't exist or has been deleted.
      </p>
      <Button asChild>
        <Link href="/admin/notifications">Back to Notifications</Link>
      </Button>
    </div>
  );
}
