'use client';

import {
  AlertCircle,
  Check,
  FolderOpen,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import {
  deleteMediaFile,
  MediaLibraryDeletionError,
} from './media-library-delete';
import type { MediaFile } from './media-library-types';

export type { MediaFile } from './media-library-types';

interface MediaLibraryProps {
  onSelect?: (url: string | null) => void;
  maxSizeMB?: number;
}

type ToastFn = ReturnType<typeof useToast>['toast'];

// Fetch the media list. Returns the file array; throws on failure so the
// caller can surface a toast. Kept at module scope so React Compiler can
// lower the component (try/catch/finally in the body triggers a bailout).
async function fetchMediaFiles(): Promise<MediaFile[]> {
  const response = await fetch('/api/media');
  if (!response.ok) throw new Error('Failed to load media');
  const data = await response.json();
  return data.files || [];
}

// Load files into state, owning the loading flag and error toast.
// `markLoading` is false on the initial mount load, where `loading` already
// starts as `true` — this avoids a synchronous setState inside the mount
// effect (which would defeat React Compiler memoization).
async function loadMediaFiles(
  setFiles: (files: MediaFile[]) => void,
  setLoading: (loading: boolean) => void,
  toast: ToastFn,
  markLoading = true
): Promise<void> {
  if (markLoading) setLoading(true);
  try {
    setFiles(await fetchMediaFiles());
  } catch (error: unknown) {
    console.error('Error loading media:', error);
    toast({
      title: 'Error',
      description: 'Failed to load media library',
      variant: 'destructive',
    });
  } finally {
    setLoading(false);
  }
}

// Upload a single file. Returns the created file URL (if any); throws on
// failure so the caller can surface a toast.
async function uploadMediaFile(file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetchWithCsrf('/api/media', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Upload failed');
  }

  const data = await response.json();
  return data.file?.url ?? null;
}

export function MediaLibrary({ onSelect, maxSizeMB = 5 }: MediaLibraryProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Load existing files
  const loadFiles = () => loadMediaFiles(setFiles, setLoading, toast);

  // Load files on mount (loading already starts true, so don't re-flag it)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only run on mount
  useEffect(() => {
    void loadMediaFiles(setFiles, setLoading, toast, false);
  }, []);

  // Handle file upload
  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const file = fileList[0];

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file (JPG, PNG, GIF, WebP)',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      toast({
        title: 'File too large',
        description: `Maximum file size is ${maxSizeMB}MB. Your file is ${sizeMB.toFixed(1)}MB`,
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    const result = await uploadMediaFile(file)
      .then((url) => ({ url, error: null as Error | null }))
      .catch((error: unknown) => ({ url: null, error: error as Error }))
      .finally(() => setUploading(false));

    if (result.error) {
      console.error('Upload error:', result.error);
      toast({
        title: 'Upload failed',
        description: result.error.message || 'Failed to upload file',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Upload successful',
      description: `${file.name} has been uploaded`,
    });

    // Reload files
    await loadFiles();

    // Auto-select the uploaded file if onSelect is provided
    if (onSelect && result.url) {
      setSelectedFile(result.url);
      onSelect(result.url);
    }
  };

  // Handle file deletion
  const handleDelete = async (fileId: string, fileName: string) => {
    if (!confirm(`Delete ${fileName}?`)) return;
    const deletedFile = files.find((file) => file.id === fileId);

    const error = await deleteMediaFile(fileId)
      .then(() => null as Error | null)
      .catch((err: unknown) => err as Error);

    if (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      if (error instanceof MediaLibraryDeletionError && error.pending) {
        await loadFiles();
        if (deletedFile && selectedFile === deletedFile.url) {
          setSelectedFile(null);
          onSelect?.(null);
        }
      }
      return;
    }

    toast({
      title: 'Deleted',
      description: `${fileName} has been deleted`,
    });

    await loadFiles();

    if (deletedFile && selectedFile === deletedFile.url) {
      setSelectedFile(null);
      onSelect?.(null);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // Filter files by search query
  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold mb-1">Media Library</h2>
          <p className="text-sm text-muted-foreground">
            Upload and manage your images
          </p>
        </div>

        {/* Upload Area */}
        <Card
          className={cn(
            'relative border-2 border-dashed transition-colors',
            dragActive ? 'border-primary bg-primary/5' : 'border-muted',
            uploading && 'opacity-50 pointer-events-none'
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Upload image"
            onChange={(e) => handleUpload(e.target.files)}
            className="hidden"
          />

          <div className="p-8 flex flex-col items-center justify-center text-center">
            {uploading ? (
              <>
                <Loader2 className="size-12 text-primary animate-spin mb-4" />
                <p className="text-sm text-muted-foreground">Uploading…</p>
              </>
            ) : (
              <>
                <Upload className="size-12 text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">Upload Image</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Drag and drop or click to browse
                </p>
                <Button
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="size-4 mr-2" />
                  Choose File
                </Button>
                <p className="text-xs text-muted-foreground mt-3">
                  JPG, PNG, GIF, WebP • Max {maxSizeMB}MB
                </p>
              </>
            )}
          </div>
        </Card>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search images..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Files Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
        ) : filteredFiles.length === 0 ? (
          <Card className="p-8 flex flex-col items-center justify-center text-center bg-muted/50">
            {searchQuery ? (
              <>
                <Search className="size-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  No images found for "{searchQuery}"
                </p>
              </>
            ) : (
              <>
                <FolderOpen className="size-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  No images yet. Upload your first image above!
                </p>
              </>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredFiles.map((file) => (
              <Card
                key={file.id}
                className={cn(
                  'relative group overflow-hidden cursor-pointer transition-all',
                  selectedFile === file.url && 'ring-2 ring-primary'
                )}
                onClick={() => {
                  if (file.deletionState === 'pending') return;
                  setSelectedFile(file.url);
                  if (onSelect) {
                    onSelect(file.url);
                  }
                }}
              >
                {file.deletionState === 'pending' && (
                  <p
                    role="status"
                    className="px-2 py-1 text-xs bg-muted text-muted-foreground"
                  >
                    Deletion pending — retry to finish
                  </p>
                )}
                {/* Image */}
                <div className="aspect-square relative bg-muted">
                  <Image
                    src={file.url}
                    alt={file.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 384px"
                    className="object-cover"
                  />

                  {/* Selection indicator */}
                  {selectedFile === file.url && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                      <Check className="size-4" />
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <CopyButton
                      value={file.url}
                      className="size-8 bg-secondary text-secondary-foreground hover:bg-secondary/80 border-0"
                      label="Copy URL"
                      successLabel="Copied!"
                    />
                    <Button
                      size="icon"
                      variant="destructive"
                      className="size-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(file.id, file.name);
                      }}
                      aria-label={`Delete ${file.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* File info */}
                <div className="p-2">
                  <p className="text-xs font-medium truncate" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Tips */}
        <Card className="p-4 bg-primary/5 border-primary/20">
          <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
            <AlertCircle className="size-4 text-primary" />
            Media Library Tips
          </h4>
          <ul className="text-xs space-y-1.5 text-muted-foreground">
            <li>• Optimize images before uploading for faster loading</li>
            <li>• Use WebP format for best compression</li>
            <li>• Recommended max width: 2000px for most images</li>
            <li>• Product images: 1000x1000px square</li>
            <li>• Click on an image to select it and copy the URL</li>
          </ul>
        </Card>
      </div>
    </ScrollArea>
  );
}
