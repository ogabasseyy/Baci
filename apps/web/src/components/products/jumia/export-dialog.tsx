'use client';

import { useState } from 'react';
import { ThemedButton } from '@/components/themed/themed-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { JumiaBrandSelector } from './brand-selector';
import { JumiaCategorySelector } from './category-selector';
import { submitJumiaExport } from './export-dialog-submit';

interface JumiaExportProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  images?: string[];
}

interface ExportToJumiaDialogProps {
  product: JumiaExportProduct;
  merchantId: string;
  integrationId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function ExportToJumiaDialog({
  product,
  merchantId,
  integrationId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
}: ExportToJumiaDialogProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset selections when dialog closes
      setCategoryCode(null);
      setBrand(null);
    }
    (controlledOnOpenChange ?? setInternalOpen)(nextOpen);
  };

  const [loading, setLoading] = useState(false);
  const [categoryCode, setCategoryCode] = useState<number | null>(null);
  const [brand, setBrand] = useState<{ code: number; name: string } | null>(
    null
  );

  const handleExport = () => {
    if (!categoryCode || !brand) {
      toast({
        title: 'Selection Required',
        description: 'Please select a Category and Brand',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    submitJumiaExport({
      product,
      merchantId,
      integrationId,
      categoryCode,
      brand,
    })
      .then((result) => {
        if (result.ok) {
          if ('partial' in result && result.partial) {
            toast({
              title: 'Export Submitted',
              description: `${result.message} Feed ID: ${result.feedId}`,
            });
            setOpen(false);
            return;
          }
          toast({
            title: 'Export Started',
            description: `Feed ID: ${result.feedId}`,
          });
          setOpen(false);
          return;
        }

        toast({
          title: 'Export Failed',
          description: result.message,
          variant: 'destructive',
        });
      })
      .catch((error) => {
        toast({
          title: 'Export Failed',
          description: error instanceof Error ? error.message : 'Export failed',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            Export to Jumia
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Export "{product.name}" to Jumia</DialogTitle>
          <DialogDescription>
            Map this product to a Jumia Category and Brand to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Category */}
          <div className="grid gap-2">
            <Label>Jumia Category (Required)</Label>
            <JumiaCategorySelector
              merchantId={merchantId}
              integrationId={integrationId}
              value={categoryCode ?? undefined}
              onSelect={(code) => {
                setCategoryCode(code);
              }}
            />
          </div>

          {/* Brand */}
          <div className="grid gap-2">
            <Label>Jumia Brand (Required)</Label>
            <JumiaBrandSelector
              merchantId={merchantId}
              integrationId={integrationId}
              value={brand}
              onSelect={setBrand}
            />
            <p className="text-xs text-muted-foreground">
              Must match a valid brand on Jumia or "Generic".
            </p>
          </div>

          {/* Price Preview */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Price</Label>
              <div className="p-2 border rounded-md bg-muted text-sm font-medium">
                {product.price}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>SKU</Label>
              <div className="p-2 border rounded-md bg-muted text-sm font-medium">
                {product.sku}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <ThemedButton onClick={handleExport} disabled={loading}>
            {loading ? 'Exporting...' : 'Export Product'}
          </ThemedButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
