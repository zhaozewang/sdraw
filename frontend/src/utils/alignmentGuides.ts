/**
 * Alignment guide and equal-spacing detection for canvas elements.
 *
 * Guide lines only appear as short indicators at the edges of the dragged element,
 * extending just enough to show which edge is aligned.
 */

export interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideLine {
  orientation: 'horizontal' | 'vertical';
  position: number;       // x for vertical, y for horizontal
  from: number;           // start of the line
  to: number;             // end of the line
  type: 'edge' | 'center';
}

export interface SpacingIndicator {
  orientation: 'horizontal' | 'vertical';
  x: number;
  y: number;
  length: number;
  gap: number;
}

export interface AlignmentResult {
  snappedX: number;
  snappedY: number;
  guides: GuideLine[];
  spacing: SpacingIndicator[];
}

const SNAP_THRESHOLD = 3;

export function computeAlignmentGuides(
  dragging: Rect,
  others: Rect[],
): AlignmentResult {
  let snappedX = dragging.x;
  let snappedY = dragging.y;

  const dL = dragging.x;
  const dR = dragging.x + dragging.width;
  const dT = dragging.y;
  const dB = dragging.y + dragging.height;
  const dCX = dragging.x + dragging.width / 2;
  const dCY = dragging.y + dragging.height / 2;

  // Find the closest snap for each axis
  let bestDx = Infinity;
  let bestDy = Infinity;

  for (const o of others) {
    const oL = o.x;
    const oR = o.x + o.width;
    const oT = o.y;
    const oB = o.y + o.height;
    const oCX = o.x + o.width / 2;
    const oCY = o.y + o.height / 2;

    // X-axis snaps: dragged edge → other edge
    for (const dVal of [dL, dR, dCX]) {
      for (const oVal of [oL, oR, oCX]) {
        const delta = oVal - dVal;
        if (Math.abs(delta) < Math.abs(bestDx) && Math.abs(delta) <= SNAP_THRESHOLD) {
          bestDx = delta;
        }
      }
    }

    // Y-axis snaps
    for (const dVal of [dT, dB, dCY]) {
      for (const oVal of [oT, oB, oCY]) {
        const delta = oVal - dVal;
        if (Math.abs(delta) < Math.abs(bestDy) && Math.abs(delta) <= SNAP_THRESHOLD) {
          bestDy = delta;
        }
      }
    }
  }

  if (Math.abs(bestDx) <= SNAP_THRESHOLD) snappedX = dragging.x + bestDx;
  if (Math.abs(bestDy) <= SNAP_THRESHOLD) snappedY = dragging.y + bestDy;

  // Build guides only from exact pixel matches after snapping
  const guides: GuideLine[] = [];
  const sL = snappedX;
  const sR = snappedX + dragging.width;
  const sT = snappedY;
  const sB = snappedY + dragging.height;
  const sCX = snappedX + dragging.width / 2;
  const sCY = snappedY + dragging.height / 2;

  for (const o of others) {
    const oL = o.x;
    const oR = o.x + o.width;
    const oT = o.y;
    const oB = o.y + o.height;
    const oCX = o.x + o.width / 2;
    const oCY = o.y + o.height / 2;

    // Vertical guides: only between the dragged element and THIS other element
    for (const sVal of [sL, sR, sCX]) {
      for (const oVal of [oL, oR, oCX]) {
        if (Math.abs(sVal - oVal) < 0.5) {
          // Line spans from the closer edges of the two elements vertically
          const top = Math.min(sT, oT);
          const bottom = Math.max(sB, oB);
          // Only show if elements are reasonably close vertically (within 2x the taller element)
          const maxH = Math.max(dragging.height, o.height);
          const vertGap = Math.max(0, top === sT ? oT - sB : sT - oB);
          if (vertGap < maxH * 3) {
            const type = (sVal === sCX && oVal === oCX) ? 'center' : 'edge';
            guides.push({ orientation: 'vertical', position: sVal, from: top, to: bottom, type });
          }
        }
      }
    }

    // Horizontal guides
    for (const sVal of [sT, sB, sCY]) {
      for (const oVal of [oT, oB, oCY]) {
        if (Math.abs(sVal - oVal) < 0.5) {
          const left = Math.min(sL, oL);
          const right = Math.max(sR, oR);
          const maxW = Math.max(dragging.width, o.width);
          const horizGap = Math.max(0, left === sL ? oL - sR : sL - oR);
          if (horizGap < maxW * 3) {
            const type = (sVal === sCY && oVal === oCY) ? 'center' : 'edge';
            guides.push({ orientation: 'horizontal', position: sVal, from: left, to: right, type });
          }
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueGuides = guides.filter(g => {
    const key = `${g.orientation}:${Math.round(g.position * 10)}`;
    if (seen.has(key)) {
      // Merge: extend existing guide range
      return false;
    }
    seen.add(key);
    return true;
  });

  // Equal spacing
  const spacing = computeEqualSpacing(
    { ...dragging, x: snappedX, y: snappedY },
    others,
  );

  return { snappedX, snappedY, guides: uniqueGuides, spacing };
}

function computeEqualSpacing(dragging: Rect, others: Rect[]): SpacingIndicator[] {
  const indicators: SpacingIndicator[] = [];
  const SPACING_THRESHOLD = 3;

  const all = [...others, dragging];

  // Horizontal
  const hSorted = [...all].sort((a, b) => a.x - b.x);
  for (let i = 0; i < hSorted.length - 2; i++) {
    const a = hSorted[i], b = hSorted[i + 1], c = hSorted[i + 2];
    const gap1 = b.x - (a.x + a.width);
    const gap2 = c.x - (b.x + b.width);
    if (gap1 > 5 && Math.abs(gap1 - gap2) < SPACING_THRESHOLD) {
      if (a.id === dragging.id || b.id === dragging.id || c.id === dragging.id) {
        const midY = (Math.min(a.y, b.y, c.y) + Math.max(a.y + a.height, b.y + b.height, c.y + c.height)) / 2;
        indicators.push({ orientation: 'horizontal', x: a.x + a.width, y: midY, length: gap1, gap: Math.round(gap1) });
        indicators.push({ orientation: 'horizontal', x: b.x + b.width, y: midY, length: gap2, gap: Math.round(gap2) });
      }
    }
  }

  // Vertical
  const vSorted = [...all].sort((a, b) => a.y - b.y);
  for (let i = 0; i < vSorted.length - 2; i++) {
    const a = vSorted[i], b = vSorted[i + 1], c = vSorted[i + 2];
    const gap1 = b.y - (a.y + a.height);
    const gap2 = c.y - (b.y + b.height);
    if (gap1 > 5 && Math.abs(gap1 - gap2) < SPACING_THRESHOLD) {
      if (a.id === dragging.id || b.id === dragging.id || c.id === dragging.id) {
        const midX = (Math.min(a.x, b.x, c.x) + Math.max(a.x + a.width, b.x + b.width, c.x + c.width)) / 2;
        indicators.push({ orientation: 'vertical', x: midX, y: a.y + a.height, length: gap1, gap: Math.round(gap1) });
        indicators.push({ orientation: 'vertical', x: midX, y: b.y + b.height, length: gap2, gap: Math.round(gap2) });
      }
    }
  }

  return indicators;
}
