const MAX_IMAGE_ZOOM_SCALE = 4;

export function getImageZoomDecodeBounds({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  return {
    height: height * MAX_IMAGE_ZOOM_SCALE,
    width: width * MAX_IMAGE_ZOOM_SCALE,
  };
}
