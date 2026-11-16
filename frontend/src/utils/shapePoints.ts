/**
 * Polygon-points generator for the rectangle node's adjustable shapes.
 * Output is in a 0..100 normalized space — callers scale to actual width/height.
 *
 * Shared between the live RectangleNode component and the export overlay so
 * both renderers produce identical geometry.
 */

export function getShapePoints(shape: string, sw: number, hl: number): string {
  const s = Math.max(0.05, Math.min(0.95, sw));
  const h = Math.max(0.05, Math.min(0.95, hl));
  const top = 50 - s * 50;
  const bot = 50 + s * 50;
  const neck = 100 - h * 100;
  switch (shape) {
    case 'encoder': return '0,0 100,18 100,82 0,100';
    case 'decoder': return '0,18 100,0 100,100 0,82';
    case 'arrow-right':
      return `0,${top} ${neck},${top} ${neck},0 100,50 ${neck},100 ${neck},${bot} 0,${bot}`;
    case 'arrow-left':
      return `0,50 ${h * 100},0 ${h * 100},${top} 100,${top} 100,${bot} ${h * 100},${bot} ${h * 100},100`;
    case 'arrow-up':
      return `50,0 100,${h * 100} ${bot},${h * 100} ${bot},100 ${top},100 ${top},${h * 100} 0,${h * 100}`;
    case 'arrow-down':
      return `${top},0 ${bot},0 ${bot},${neck} 100,${neck} 50,100 0,${neck} ${top},${neck}`;
    case 'arrow-double':
      return `0,50 ${h * 50},0 ${h * 50},${top} ${100 - h * 50},${top} ${100 - h * 50},0 100,50 ${100 - h * 50},100 ${100 - h * 50},${bot} ${h * 50},${bot} ${h * 50},100`;
    case 'chevron': {
      const indent = h * 100;
      return `0,0 ${100 - indent},0 100,50 ${100 - indent},100 0,100 ${indent},50`;
    }
    case 'diamond':
      return '50,0 100,50 50,100 0,50';
    case 'triangle':
      return '50,0 100,100 0,100';
    default:
      return '50,0 100,100 0,100';
  }
}

/** Adjustable shapes expose shaft/head drag handles in the live editor. */
export const ADJUSTABLE_SHAPES = new Set([
  'arrow-right',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'arrow-double',
  'chevron',
]);
