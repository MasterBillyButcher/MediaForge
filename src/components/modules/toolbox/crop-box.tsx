'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Crop rectangle in normalized (0..1) image coordinates. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type DragMode = 'move' | HandleId;

interface DragState {
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  rect: NormRect;
  dispW: number;
  dispH: number;
}

const MIN = 0.03;
const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_CLASS: Record<HandleId, string> = {
  nw: '-left-2.5 -top-2.5 cursor-nwse-resize',
  n: 'left-1/2 -translate-x-1/2 -top-2.5 cursor-ns-resize',
  ne: '-right-2.5 -top-2.5 cursor-nesw-resize',
  e: 'top-1/2 -translate-y-1/2 -right-2.5 cursor-ew-resize',
  se: '-right-2.5 -bottom-2.5 cursor-nwse-resize',
  s: 'left-1/2 -translate-x-1/2 -bottom-2.5 cursor-ns-resize',
  sw: '-left-2.5 -bottom-2.5 cursor-nesw-resize',
  w: 'top-1/2 -translate-y-1/2 -left-2.5 cursor-ew-resize',
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function computeMove(start: NormRect, dx: number, dy: number): NormRect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

function computeResize(
  start: NormRect,
  mode: HandleId,
  dx: number,
  dy: number,
  aspectNorm: number | null
): NormRect {
  if (aspectNorm == null) {
    let x = start.x;
    let y = start.y;
    let x2 = x + start.w;
    let y2 = y + start.h;
    if (mode.includes('w')) x = clamp(x + dx, 0, x2 - MIN);
    if (mode.includes('e')) x2 = clamp(x2 + dx, x + MIN, 1);
    if (mode.includes('n')) y = clamp(y + dy, 0, y2 - MIN);
    if (mode.includes('s')) y2 = clamp(y2 + dy, y + MIN, 1);
    return { x, y, w: x2 - x, h: y2 - y };
  }

  const { x, y, w, h } = start;

  const dirX = mode.includes('w') ? -1 : mode.includes('e') ? 1 : 0;
  const dirY = mode.includes('n') ? -1 : mode.includes('s') ? 1 : 0;

  if (dirX !== 0 && dirY !== 0) {
    // Corner handle: width follows dx, height follows the locked aspect.
    let nw = Math.max(MIN, dirX === 1 ? w + dx : w - dx);
    let nh = nw / aspectNorm;
    const maxW = dirX === 1 ? 1 - x : x + w;
    const maxH = dirY === 1 ? 1 - y : y + h;
    if (nh > maxH) {
      nh = Math.max(MIN, maxH);
      nw = nh * aspectNorm;
    }
    if (nw > maxW) {
      nw = Math.max(MIN, maxW);
      nh = nw / aspectNorm;
    }
    if (nh > maxH) {
      nh = Math.max(MIN, maxH);
      nw = nh * aspectNorm;
    }
    return {
      x: dirX === 1 ? x : x + w - nw,
      y: dirY === 1 ? y : y + h - nh,
      w: nw,
      h: nh,
    };
  }

  if (dirX !== 0) {
    // East/west edge: resize width, keep vertical center.
    let nw = Math.max(MIN, dirX === 1 ? w + dx : w - dx);
    const maxW = dirX === 1 ? 1 - x : x + w;
    if (nw > maxW) nw = Math.max(MIN, maxW);
    let nh = nw / aspectNorm;
    if (nh > 1) {
      nh = 1;
      nw = nh * aspectNorm;
      if (nw > maxW) {
        nw = Math.max(MIN, maxW);
        nh = nw / aspectNorm;
      }
    }
    return {
      x: dirX === 1 ? x : x + w - nw,
      y: clamp(y + h / 2 - nh / 2, 0, 1 - nh),
      w: nw,
      h: nh,
    };
  }

  // North/south edge: resize height, keep horizontal center.
  let nh = Math.max(MIN, dirY === 1 ? h + dy : h - dy);
  const maxH = dirY === 1 ? 1 - y : y + h;
  if (nh > maxH) nh = Math.max(MIN, maxH);
  let nw = nh * aspectNorm;
  if (nw > 1) {
    nw = 1;
    nh = nw / aspectNorm;
    if (nh > maxH) {
      nh = Math.max(MIN, maxH);
      nw = nh * aspectNorm;
    }
  }
  return {
    x: clamp(x + w / 2 - nw / 2, 0, 1 - nw),
    y: dirY === 1 ? y : y + h - nh,
    w: nw,
    h: nh,
  };
}

/** Adjust a rect to the given normalized aspect, keeping its center, inside the image. */
export function fitRectToAspect(r: NormRect, aspectNorm: number): NormRect {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let w = r.w;
  let h = w / aspectNorm;
  if (h > r.h) {
    h = r.h;
    w = h * aspectNorm;
  }
  if (w > 1) {
    w = 1;
    h = w / aspectNorm;
  }
  if (h > 1) {
    h = 1;
    w = h * aspectNorm;
  }
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** Convert a normalized rect into source-pixel crop coordinates for ImageOps. */
export function rectToSourcePixels(
  rect: NormRect,
  naturalWidth: number,
  naturalHeight: number
): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(rect.x * naturalWidth), 0, naturalWidth - 1);
  const top = clamp(Math.round(rect.y * naturalHeight), 0, naturalHeight - 1);
  const width = clamp(Math.round(rect.w * naturalWidth), 1, naturalWidth - left);
  const height = clamp(Math.round(rect.h * naturalHeight), 1, naturalHeight - top);
  return { left, top, width, height };
}

export interface CropBoxProps {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  rect: NormRect;
  /** Desired pixel aspect ratio (W/H), or null for free crop. */
  aspect: number | null;
  onChange: (rect: NormRect) => void;
  /** Reports the real intrinsic size of the loaded image (fallback when probe metadata is missing). */
  onNatural?: (width: number, height: number) => void;
}

export function CropBox({ src, naturalWidth, naturalHeight, rect, aspect, onChange, onNatural }: CropBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const aspectNorm = aspect == null ? null : (aspect * naturalHeight) / naturalWidth;

  const pct = (v: number) => `${v * 100}%`;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle as HandleId | undefined;
    const isMove = target.dataset.role === 'move' || !!target.closest('[data-role="move"]');
    if (!handle && !isMove) return;
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const bounds = img.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    setDrag({
      mode: handle ?? 'move',
      startClientX: e.clientX,
      startClientY: e.clientY,
      rect,
      dispW: bounds.width,
      dispH: bounds.height,
    });
    container.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startClientX) / drag.dispW;
    const dy = (e.clientY - drag.startClientY) / drag.dispH;
    const next =
      drag.mode === 'move'
        ? computeMove(drag.rect, dx, dy)
        : computeResize(drag.rect, drag.mode, dx, dy, aspectNorm);
    onChange(next);
  };

  const endDrag = () => setDrag(null);

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none touch-none overflow-hidden rounded-lg bg-muted"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label="Interactive crop area. Drag inside the rectangle to move it, drag its corners or edges to resize."
      role="application"
    >
      <img
        ref={imgRef}
        src={src}
        alt="Image being cropped"
        draggable={false}
        onLoad={() => {
          const img = imgRef.current;
          if (img && img.naturalWidth > 0) onNatural?.(img.naturalWidth, img.naturalHeight);
        }}
        className="pointer-events-none block h-auto w-full"
      />
      <div
        data-role="move"
        aria-hidden
        className="absolute cursor-move border-2 border-primary"
        style={{
          left: pct(rect.x),
          top: pct(rect.y),
          width: pct(rect.w),
          height: pct(rect.h),
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        }}
      >
        <div className="absolute inset-0 border border-white/40" />
        {HANDLES.map((id) => (
          <div
            key={id}
            data-handle={id}
            aria-hidden
            className={cn(
              'absolute h-5 w-5 rounded-full border-2 border-primary bg-background shadow-md',
              HANDLE_CLASS[id]
            )}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white">
        {Math.round(rect.w * naturalWidth)} × {Math.round(rect.h * naturalHeight)} px
      </div>
    </div>
  );
}
