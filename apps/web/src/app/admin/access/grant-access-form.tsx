'use client';

import { Loader2, ShieldPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  type PlatformAdminRole,
  platformAdminRoles,
} from '@/config/platform-admin-rbac';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';

interface GrantAccessFormProps {
  onUpdated: () => Promise<void>;
}

export function GrantAccessForm({ onUpdated }: GrantAccessFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PlatformAdminRole>('viewer');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reactivate, setReactivate] = useState(false);

  const submitMembership = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/admin/access', {
        body: JSON.stringify({ confirmed, email, reactivate, reason, role }),
        method: 'POST',
      });
      if (!response.ok) throw new Error('platform_access_upsert_failed');
      setEmail('');
      setReason('');
      setConfirmed(false);
      setReactivate(false);
      await onUpdated();
      toast({ title: 'Platform access updated' });
    } catch {
      toast({
        title: 'Access was not updated',
        description:
          'Check the account, reason, confirmation, and owner safety rules.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldPlus className="size-5 text-primary" aria-hidden="true" />
          Grant or change access
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submitMembership}>
          <div className="space-y-2">
            <Label htmlFor="access-email">Account email</Label>
            <Input
              id="access-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="operator@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="access-role">Platform role</Label>
            <select
              id="access-role"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as PlatformAdminRole)
              }
            >
              {platformAdminRoles.map((option) => (
                <option key={option} value={option} className="capitalize">
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="access-reason">Reason for this change</Label>
            <Textarea
              id="access-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe the operational need. This is retained in the membership record."
            />
          </div>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox
              id="access-reactivate"
              checked={reactivate}
              onCheckedChange={(value) => setReactivate(value === true)}
            />
            <Label htmlFor="access-reactivate" className="leading-5">
              Reactivate a previously revoked membership. Leave unchecked for a
              new or currently active account.
            </Label>
          </div>
          <div className="flex items-start gap-2 text-sm font-medium">
            <Checkbox
              id="access-confirmed"
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <Label htmlFor="access-confirmed" className="leading-5">
              I confirm this role is necessary and appropriately scoped.
            </Label>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={saving || !confirmed}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Save platform access
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
