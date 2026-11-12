export function rectFromPoints(a, b, width, height) {
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  const x1 = clamp(a.x, width), y1 = clamp(a.y, height);
  const x2 = clamp(b.x, width), y2 = clamp(b.y, height);
  return {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
}

export function fitImage(naturalWidth, naturalHeight, width, height) {
  const scale = Math.min(width / naturalWidth, height / naturalHeight);
  return {x: (width - naturalWidth * scale) / 2, y: (height - naturalHeight * scale) / 2,
    width: naturalWidth * scale, height: naturalHeight * scale, scale};
}

// Round both edges independently, preserving the exact selected pixel range at HiDPI.
export function toPixels(rect, fit, naturalWidth, naturalHeight) {
  const clamp = (v, max) => Math.min(max, Math.max(0, Math.round(v)));
  const x = clamp((rect.x - fit.x) / fit.scale, naturalWidth);
  const y = clamp((rect.y - fit.y) / fit.scale, naturalHeight);
  const right = clamp((rect.x + rect.width - fit.x) / fit.scale, naturalWidth);
  const bottom = clamp((rect.y + rect.height - fit.y) / fit.scale, naturalHeight);
  return {x, y, width: right - x, height: bottom - y};
}
