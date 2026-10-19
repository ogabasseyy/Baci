import { Ban, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminPlatformAccessMembership } from '@/schemas/admin-platform-access';

interface AccessMembersTableProps {
  members: AdminPlatformAccessMembership[];
  onRevoke: (member: AdminPlatformAccessMembership) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AccessMembersTable({
  members,
  onRevoke,
}: AccessMembersTableProps) {
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <ShieldCheck className="mx-auto mb-3 size-6 text-muted-foreground" />
        <p className="font-medium">No managed platform members yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add an authenticated account above to grant a scoped platform role.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Granted</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.email}>
              <TableCell>
                <div className="font-medium">{member.email}</div>
                {member.is_legacy_owner ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Legacy owner — managed through the existing merchant flag
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="capitalize">{member.role}</TableCell>
              <TableCell>
                <Badge
                  variant={member.status === 'active' ? 'secondary' : 'outline'}
                >
                  {member.status}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDate(member.granted_at)}
              </TableCell>
              <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                {member.reason}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!member.is_revocable}
                  onClick={() => onRevoke(member)}
                >
                  <Ban className="mr-2 size-3.5" aria-hidden="true" />
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
