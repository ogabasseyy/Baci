import { PixelRatio } from 'react-native';
import { clampImageDecodeDimension } from './image-decode-dimensions';

interface BoundedImageSourceOptions {
  height: number;
  pixelRatio?: number;
  uri: string;
  width: number;
}

export function createBoundedImageSource({
  height,
  pixelRatio = PixelRatio.get(),
  uri,
  width,
}: BoundedImageSourceOptions) {
  return {
    height: clampImageDecodeDimension(height * pixelRatio),
    uri,
    width: clampImageDecodeDimension(width * pixelRatio),
  };
}
