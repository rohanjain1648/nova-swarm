/**
 * Uniform spatial hash for broad-phase collision queries.
 *
 * With hundreds of enemies on screen, testing every projectile against every
 * enemy is O(bullets × enemies) and tanks the frame rate. The grid buckets
 * enemies into cells so each query only inspects nearby candidates. It's
 * rebuilt each simulation step (cheap: clear + re-insert), which keeps it
 * correct without incremental bookkeeping.
 */

export interface HasPosition {
  x: number;
  y: number;
  radius: number;
  dead: boolean;
}

export class SpatialGrid<T extends HasPosition> {
  private cells = new Map<number, T[]>();
  private readonly inv: number;

  constructor(cellSize: number) {
    this.inv = 1 / cellSize;
  }

  private key(cx: number, cy: number): number {
    // Cantor-ish pack; cell coords fit comfortably for our world size.
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  clear(): void {
    this.cells.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.x * this.inv);
    const cy = Math.floor(item.y * this.inv);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(item);
  }

  rebuild(items: readonly T[]): void {
    this.clear();
    for (let i = 0; i < items.length; i++) {
      if (!items[i].dead) this.insert(items[i]);
    }
  }

  /**
   * Invoke `cb` for every item whose cell overlaps the query circle. The
   * callback should do the precise distance test itself. Returning nothing;
   * callers accumulate. Reuses no allocations in the common path.
   */
  query(x: number, y: number, r: number, cb: (item: T) => void): void {
    const minX = Math.floor((x - r) * this.inv);
    const maxX = Math.floor((x + r) * this.inv);
    const minY = Math.floor((y - r) * this.inv);
    const maxY = Math.floor((y + r) * this.inv);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const it = bucket[i];
          if (!it.dead) cb(it);
        }
      }
    }
  }

  /** Return the nearest non-dead item to (x,y) within maxR, or null. */
  nearest(x: number, y: number, maxR: number): T | null {
    let best: T | null = null;
    let bestD2 = maxR * maxR;
    this.query(x, y, maxR, (it) => {
      const dx = it.x - x;
      const dy = it.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = it;
      }
    });
    return best;
  }
}
