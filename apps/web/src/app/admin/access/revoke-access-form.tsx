'use client';

import { Loader2, UserRoundX } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import type { AdminPlatformAccessMembership } from '@/schemas/admin-platform-access';

interface RevokeAccessFormProps {
  member: AdminPlatformAccessMembership;
  onCancel: () => void;
  onComplete: () => Promise<void>;
}

export function RevokeAccessForm({
  member,
  onCancel,
  onComplete,
}: RevokeAccessFormProps) {
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRevoking(true);
    try {
      const response = await fetchWithCsrf('/api/admin/access', {
        body: JSON.stringify({ confirmed, email: member.email, reason }),
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('platform_access_revoke_failed');
      await onComplete();
      toast({ title: 'Platform access revoked' });
    } catch {
      toast({
        title: 'Access was not revoked',
        description: 'The final owner and your own access cannot be removed.',
        variant: 'destructive',
      });
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <UserRoundX className="size-5" aria-hidden="true" />
          Revoke {member.email}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <Textarea
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for revoking this access"
            aria-label="Revocation reason"
          />
          <div className="flex items-start gap-2 text-sm font-medium">
            <Checkbox
              id="revoke-confirmed"
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <Label htmlFor="revoke-confirmed" className="leading-5">
              I confirm this operator should lose platform access.
            </Label>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={revoking || !confirmed}
            >
              {revoking ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Confirm revocation
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
