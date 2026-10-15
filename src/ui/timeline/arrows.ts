import type { DepType } from '../../engine';

export interface BarBox {
  /** Left and right x of the bar (diamond extents for milestones). */
  x0: number;
  x1: number;
  /** Vertical centre. */
  y: number;
}

const STUB = 7;

/**
 * Orthogonal route for a link. Arrows leave the predecessor's start (SS/SF) or finish (FS/FF)
 * and enter the successor's start (FS/SS) or finish (FF/SF).
 */
export function linkPath(type: DepType, a: BarBox, b: BarBox, rowH: number): string {
  const dir = b.y >= a.y ? 1 : -1;
  const between = a.y + (dir * rowH) / 2;
  switch (type) {
    case 'FS': {
      const sx = a.x1;
      const tx = b.x0;
      if (tx - sx >= STUB * 2) {
        const mx = sx + STUB;
        return `M${sx},${a.y}H${mx}V${b.y}H${tx}`;
      }
      return `M${sx},${a.y}H${sx + STUB}V${between}H${tx - STUB}V${b.y}H${tx}`;
    }
    case 'SS': {
      const mx = Math.min(a.x0, b.x0) - STUB;
      return `M${a.x0},${a.y}H${mx}V${b.y}H${b.x0}`;
    }
    case 'FF': {
      const mx = Math.max(a.x1, b.x1) + STUB;
      return `M${a.x1},${a.y}H${mx}V${b.y}H${b.x1}`;
    }
    case 'SF': {
      const sx = a.x0;
      const tx = b.x1;
      if (sx - tx >= STUB * 2) {
        const mx = sx - STUB;
        return `M${sx},${a.y}H${mx}V${b.y}H${tx}`;
      }
      return `M${sx},${a.y}H${sx - STUB}V${between}H${tx + STUB}V${b.y}H${tx}`;
    }
  }
}
