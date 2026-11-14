'use client';

import { Image as ImageIcon, Link as LinkIcon } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isImeComposing } from '@/lib/is-ime-composing';
import { MediaLibrary } from '../media-library';

interface ImagePickerFieldProps {
  field: { label?: string };
  onChange: (value: string) => void;
  value: string;
}

export function ImagePickerField({
  field,
  onChange,
  value,
}: ImagePickerFieldProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'library' | 'url'>('library');

  const handleSelectImage = (url: string | null) => {
    onChange(url ?? '');
    if (url) {
      setDialogOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{field.label || 'Image'}</Label>

      {/* Image Preview */}
      {value && (
        <div className="relative w-full aspect-video rounded-lg overflow-hidden border bg-muted">
          <Image
            src={value}
            alt="Preview"
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}

      {/* Picker Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full">
            <ImageIcon className="size-4 mr-2" />
            {value ? 'Change Image' : 'Choose Image'}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Select Image</DialogTitle>
            <DialogDescription>
              Choose from your media library or paste an external URL
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'library' | 'url')}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="library">Media Library</TabsTrigger>
              <TabsTrigger value="url">External URL</TabsTrigger>
            </TabsList>

            <TabsContent value="library" className="mt-4">
              <div className="max-h-[500px] overflow-hidden">
                <MediaLibrary onSelect={handleSelectImage} maxSizeMB={5} />
              </div>
            </TabsContent>

            <TabsContent value="url" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="external-url">Image URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="external-url"
                    type="url"
                    placeholder="https://example.com/image.jpg"
                    defaultValue={value}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (isImeComposing(e)) {
                          // Cancel the composing Enter so a surrounding form cannot submit.
                          e.preventDefault();
                          return;
                        }
                        onChange(e.currentTarget.value);
                        setDialogOpen(false);
                      }
                    }}
                  />
                  <Button
                    onClick={() => {
                      const input = document.getElementById(
                        'external-url'
                      ) as HTMLInputElement;
                      if (input?.value) {
                        onChange(input.value);
                        setDialogOpen(false);
                      }
                    }}
                  >
                    <LinkIcon className="size-4 mr-2" />
                    Use URL
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste a URL from Unsplash, your CDN, or any other source
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Current URL display */}
      {value && (
        <p className="text-xs text-muted-foreground truncate" title={value}>
          {value}
        </p>
      )}
    </div>
  );
}
