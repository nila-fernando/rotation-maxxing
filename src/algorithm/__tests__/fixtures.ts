/** Shared test fixtures. Synthetic farms only; nothing here is real data. */
import { SQ_M_PER_ACRE } from '../geometry';
import type { Farm, Land, Market, Paddock, Priorities, XY } from '../types';

export function land(over: Partial<Land> = {}): Land {
  return { slopePct: 2, texture: 'loam', drainage: 'good', salinityECe: 0.5, ph: 6.5, ...over };
}

export function rect(x: number, y: number, w: number, h: number): XY[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Every crop in croptraits.ts. */
export const ALL_CROPS = [
  'corn', 'soybeans', 'winter-wheat', 'spring-wheat', 'sorghum', 'cotton', 'alfalfa',
  'oats', 'barley', 'sunflower', 'canola', 'dry-beans', 'cereal-rye', 'fallow',
];

export function paddock(id: string, ring: XY[], over: Partial<Paddock> = {}): Paddock {
  const acres = Math.abs(ringArea(ring)) / SQ_M_PER_ACRE;
  return {
    id,
    name: id,
    acres,
    polygon: { localM: ring },
    land: land(),
    history: ['corn', 'soybeans', 'corn'],
    availableCrops: ALL_CROPS,
    ...over,
  };
}

function ringArea(r: XY[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[(i + 1) % r.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** A grid of square paddocks, `cols` wide and `rows` high, each `acres` in size. */
export function gridFarm(cols: number, rows: number, acres: number, over: Partial<Paddock> = {}): Farm {
  const side = Math.sqrt(acres * SQ_M_PER_ACRE);
  const paddocks: Paddock[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      paddocks.push(paddock(`p${r}${c}`, rect(c * side, r * side, side, side), over));
    }
  }
  return { latitude: 42, state: 'IA', paddocks };
}

export const NEUTRAL: Priorities = { profit: 50, soilHealth: 50, water: 50, risk: 50 };

/** A market with no local cap (huge demand) at the croptraits typical price, for the given crops. */
export function openMarket(prices: Record<string, number>): Market {
  const m: Market = {};
  for (const [id, price] of Object.entries(prices)) {
    m[id] = { localDemand: 1e12, localPrice: price, distantPrice: price, freightPerUnit: 0 };
  }
  return m;
}
