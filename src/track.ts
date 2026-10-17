// Plain track data + the little geometry it needs. No Phaser dependency, so it is trivial to reason about.

export interface Vec { x: number; y: number }
/** A line across the road. Checkpoints and the finish line are gates. */
export interface Gate { a: Vec; b: Vec }
export interface Blocker { x: number; y: number; r: number }

export interface Track {
  /** Road centerline. The road is this polyline drawn `width` px thick with round joints. */
  points: Vec[];
  width: number;
  /** Must be crossed in array order. */
  checkpoints: Gate[];
  finish: Gate | null;
  blockers: Blocker[];
}

export const emptyTrack = (width: number): Track => ({ points: [], width, checkpoints: [], finish: null, blockers: [] });

export const mid = (g: Gate): Vec => ({ x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 });

export interface Nearest { point: Vec; dist: number; dir: Vec }

/** Closest point on a polyline to `p`, its distance, and the unit direction of the segment it lies on. */
export function nearestOnPolyline(points: Vec[], p: Vec): Nearest | null {
  let best: Nearest | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dist < best.dist) best = { point: q, dist, dir: { x: dx / len, y: dy / len } };
  }
  return best;
}

/** Gate spanning the full road width at the road position nearest to `p`, or null when `p` is off the road. */
export function gateAt(track: Track, p: Vec): Gate | null {
  const n = nearestOnPolyline(track.points, p);
  const hw = track.width / 2;
  if (!n || n.dist > hw) return null;
  const nx = -n.dir.y * hw, ny = n.dir.x * hw; // road normal scaled to half width
  return { a: { x: n.point.x - nx, y: n.point.y - ny }, b: { x: n.point.x + nx, y: n.point.y + ny } };
}

/** Distance from `p` to a gate segment (used by the erase tool). */
export const distToGate = (g: Gate, p: Vec): number => nearestOnPolyline([g.a, g.b], p)!.dist;
