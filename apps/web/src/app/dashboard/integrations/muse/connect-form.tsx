'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONNECTOR_TOOL_SCOPES } from '@/lib/connector/manifest';

import type { useMuseConnections } from './use-muse-connections';

const SCOPE_LABELS: Record<string, string> = {
  'orders:read': 'Orders',
  'inventory:read': 'Inventory',
  'analytics:read': 'Analytics',
};

const EXPIRY_OPTIONS = [
  { label: '24 hours', value: '86400' },
  { label: '7 days', value: '604800' },
  { label: '30 days', value: '2592000' },
  { label: 'No expiry', value: 'never' },
];

export function ConnectForm({
  model,
}: {
  model: ReturnType<typeof useMuseConnections>;
}) {
  const {
    status,
    branches,
    scopes,
    merchantWide,
    branchIds,
    expiry,
    connecting,
    setMerchantWide,
    setExpiry,
    toggleScope,
    toggleBranch,
    handleConnect,
  } = model;
  const connections = status?.connections ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {connections.length === 0 ? 'Connect Muse' : 'Connect another agent'}
        </CardTitle>
        <CardDescription>
          Creates another scoped grant for this merchant. Read-only scopes; Muse
          can never change orders, inventory, or settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Read scopes</legend>
          {CONNECTOR_TOOL_SCOPES.map((scope) => (
            <div key={scope} className="flex items-center gap-2">
              <Checkbox
                id={`scope-${scope}`}
                checked={scopes.includes(scope)}
                onCheckedChange={(checked) =>
                  toggleScope(scope, checked === true)
                }
              />
              <Label htmlFor={`scope-${scope}`}>
                {SCOPE_LABELS[scope]} ({scope})
              </Label>
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Branch access</legend>
          <RadioGroup
            value={merchantWide ? 'merchant' : 'branches'}
            onValueChange={(value) => setMerchantWide(value === 'merchant')}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="scope-merchant" value="merchant" />
              <Label htmlFor="scope-merchant">
                Entire merchant (all branches)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="scope-branches" value="branches" />
              <Label htmlFor="scope-branches">Selected branches</Label>
            </div>
          </RadioGroup>
          {!merchantWide && (
            <div className="space-y-2 pl-6">
              {branches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No branches found for this merchant.
                </p>
              ) : (
                branches.map((branch) => (
                  <div key={branch.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`branch-${branch.id}`}
                      checked={branchIds.includes(branch.id)}
                      onCheckedChange={(checked) =>
                        toggleBranch(branch.id, checked === true)
                      }
                    />
                    <Label htmlFor={`branch-${branch.id}`}>
                      {branch.name}
                      {branch.is_default ? ' (default)' : ''}
                    </Label>
                  </div>
                ))
              )}
            </div>
          )}
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="connector-expiry">Access expires after</Label>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger id="connector-expiry" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleConnect}
          disabled={
            connecting ||
            scopes.length === 0 ||
            (!merchantWide && branchIds.length === 0)
          }
        >
          {connecting ? 'Connecting…' : 'Connect Muse'}
        </Button>
      </CardContent>
    </Card>
  );
}
