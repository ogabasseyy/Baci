import { Building2, Filter, Search } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_MERCHANT_SALES_ACTIVITY } from '@/config/admin-merchant-sales-activity';
import type { AdminMerchantHealthRow } from '@/types/admin-merchants';
import { type HealthFilter, isHealthFilter } from './merchant-health-filter';
import { MerchantTable } from './merchant-table';

const SKELETON_ROW_COUNT = 3;

interface MerchantDirectoryCardProps {
  filteredMerchants: AdminMerchantHealthRow[];
  healthFilter: HealthFilter;
  loading: boolean;
  onHealthFilterChange: (value: HealthFilter) => void;
  onInvalidStorefrontUrl: () => void;
  onSearchQueryChange: (value: string) => void;
  onSortByChange: (value: string) => void;
  searchQuery: string;
  sortBy: 'gmv' | 'orders' | 'joined';
}

export function MerchantDirectoryCard({
  filteredMerchants,
  healthFilter,
  loading,
  onHealthFilterChange,
  onInvalidStorefrontUrl,
  onSearchQueryChange,
  onSortByChange,
  searchQuery,
  sortBy,
}: MerchantDirectoryCardProps) {
  return (
    <Card className="glass">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search merchants..."
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={healthFilter}
              onValueChange={(value) => {
                if (isHealthFilter(value)) {
                  onHealthFilterChange(value);
                }
              }}
            >
              <SelectTrigger
                className="w-[170px]"
                aria-label="Paid sales activity"
              >
                <Filter className="mr-2 size-4" aria-hidden="true" />
                <SelectValue placeholder="Sales Activity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sales Activity</SelectItem>
                <SelectItem value="healthy">
                  {ADMIN_MERCHANT_SALES_ACTIVITY.healthy.label}
                </SelectItem>
                <SelectItem value="at_risk">
                  {ADMIN_MERCHANT_SALES_ACTIVITY.at_risk.label}
                </SelectItem>
                <SelectItem value="churned">
                  {ADMIN_MERCHANT_SALES_ACTIVITY.churned.label}
                </SelectItem>
                <SelectItem value="new">
                  {ADMIN_MERCHANT_SALES_ACTIVITY.new.label}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={onSortByChange}>
              <SelectTrigger className="w-[150px]" aria-label="Sort merchants">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gmv">Highest NGN Paid GMV</SelectItem>
                <SelectItem value="orders">Most Orders</SelectItem>
                <SelectItem value="joined">Recently Joined</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton rows are transient placeholders.
                key={index}
                className="flex items-center gap-4 rounded-lg border p-4"
              >
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        ) : filteredMerchants.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Building2
              className="mx-auto mb-4 size-12 opacity-50"
              aria-hidden="true"
            />
            <p className="font-medium">No merchants found</p>
            <p className="text-sm">
              {searchQuery || healthFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Merchants will appear here once they sign up'}
            </p>
          </div>
        ) : (
          <MerchantTable
            merchants={filteredMerchants}
            onInvalidStorefrontUrl={onInvalidStorefrontUrl}
          />
        )}
      </CardContent>
    </Card>
  );
}
