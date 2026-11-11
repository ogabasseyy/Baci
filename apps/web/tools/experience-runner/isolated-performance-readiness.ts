/** Evaluated only inside the collector's validated Chromium isolated context. */
export function isolatedReadinessExpression(role: 'host' | 'child') {
  return role === 'host'
    ? `(() => {
          const frame = document.querySelector('iframe');
          const rect = frame?.getBoundingClientRect();
          let visible = Boolean(frame && rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth);
          for (let node = frame; visible && node; node = node.parentElement) {
            const style = getComputedStyle(node);
            visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
          }
          visible = visible && (!document.documentElement.hasAttribute('data-baci-performance-reference') || document.documentElement.dataset.baciPerformanceBridgeReady === 'true');
          return { visible, timeOrigin: performance.timeOrigin };
        })()`
    : `(() => {
          const root = document.querySelector('#root, #__next');
          if (!root || root.inert) return { visible: false, imagesDecoded: false };
          const rect = root.getBoundingClientRect();
          const nonblank = (root.textContent ?? '').trim().length > 0 || Boolean(root.querySelector('img,svg,canvas,video'));
          let ancestorsVisible = true;
          for (let node = root; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) ancestorsVisible = false;
          }
          const visible = nonblank && ancestorsVisible && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
          const images = [...document.images].filter((image) => {
            const box = image.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
          });
          return { visible, imagesDecoded: images.every((image) => image.complete && image.naturalWidth > 0) };
        })()`;
}
