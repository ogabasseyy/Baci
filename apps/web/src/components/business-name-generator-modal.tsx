'use client';

import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { guideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { isImeComposing } from '@/lib/is-ime-composing';
import { cn } from '@/lib/utils';

interface BusinessNameGeneratorModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onNameSelect: (name: string) => void;
  businessType?: string;
}

interface GenerateNamesCallbacks {
  setIsGenerating: (value: boolean) => void;
  setGeneratedNames: (names: string[]) => void;
  toast: ReturnType<typeof useToast>['toast'];
}

async function runGenerateNames(
  description: string,
  tone: string,
  { setIsGenerating, setGeneratedNames, toast }: GenerateNamesCallbacks
) {
  if (!description.trim()) {
    toast({
      title: 'Description required',
      description: 'Please describe your business.',
      variant: 'destructive',
    });
    return;
  }

  setIsGenerating(true);
  setGeneratedNames([]);

  try {
    const result = await guideBusinessOnboarding({
      businessName: 'placeholder',
      businessType: 'placeholder',
      brandPreferences: 'placeholder',
      task: 'generate_names',
      description,
      tone,
    });

    if (result.businessNames && result.businessNames.length > 0) {
      setGeneratedNames(result.businessNames);
    } else {
      toast({
        title: 'No names generated',
        description: 'Please try again with a different description.',
        variant: 'destructive',
      });
    }
  } catch (error) {
    console.error('Failed to generate names:', error);
    const description =
      error instanceof Error
        ? error.message
        : 'Something went wrong. Please try again.';
    toast({
      title: 'Generation failed',
      description,
      variant: 'destructive',
    });
  } finally {
    setIsGenerating(false);
  }
}

const TONES = [
  'Modern',
  'Classic',
  'Playful',
  'Professional',
  'Luxury',
  'Minimalist',
  'Tech-focused',
  'Organic',
];

const PLACEHOLDERS: Record<string, string> = {
  fashion:
    'e.g., A sustainable clothing brand focusing on minimalist designs and organic materials...',
  electronics:
    'e.g., A tech store specializing in smart home devices and high-end audio gear...',
  'home-goods':
    'e.g., A home decor shop offering handcrafted furniture and artisanal textiles...',
  'health-beauty':
    'e.g., A natural skincare line using organic ingredients for sensitive skin...',
  handmade:
    'e.g., A pottery studio creating unique, hand-thrown mugs and bowls...',
  'food-beverage':
    'e.g., A gourmet burger joint serving locally sourced ingredients and craft beers...',
  'hair-extensions':
    'e.g., A luxury hair extension brand offering 100% human hair bundles and wigs...',
  default:
    'e.g., A sustainable coffee shop that serves fair-trade beans and artisanal pastries in a cozy, modern atmosphere...',
};

export function BusinessNameGeneratorModal({
  isOpen,
  onOpenChange,
  onNameSelect,
  businessType,
}: BusinessNameGeneratorModalProps) {
  const [description, setDescription] = useState('');
  const [tone, setTone] = useState('Modern');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNames, setGeneratedNames] = useState<string[]>([]);
  const { toast } = useToast();

  const placeholder =
    businessType && PLACEHOLDERS[businessType]
      ? PLACEHOLDERS[businessType]
      : PLACEHOLDERS.default;

  const handleGenerate = () =>
    runGenerateNames(description, tone, {
      setIsGenerating,
      setGeneratedNames,
      toast,
    });

  const handleSelectName = (name: string) => {
    onNameSelect(name);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="size-5 text-primary" />
            AI Business Name Generator
          </DialogTitle>
          <DialogDescription>
            Describe your business and let AI suggest creative names for you.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder={placeholder}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !isGenerating &&
                    !isImeComposing(e)
                  ) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tone">Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger id="tone">
                  <SelectValue placeholder="Select a tone" />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Generating Ideas…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  Generate Names
                </>
              )}
            </Button>
          </div>

          {generatedNames.length > 0 && (
            <div className="space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">Suggestions</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-primary"
                >
                  <RefreshCw
                    className={cn(
                      'mr-1 h-3 w-3',
                      isGenerating && 'animate-spin'
                    )}
                  />
                  Regenerate
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {generatedNames.map((name, index) => (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: Generated names don't have IDs
                    key={index}
                    type="button"
                    onClick={() => handleSelectName(name)}
                    className="group relative flex items-center justify-center rounded-lg border bg-card p-4 text-center text-sm font-medium transition-all hover:border-primary hover:bg-primary/5 hover:shadow-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
