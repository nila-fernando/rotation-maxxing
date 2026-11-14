import { describe, expect, it } from 'vitest';
import { lngLatToLocal, prepareFarm, SQ_M_PER_ACRE } from '../geometry';
import type { Farm, Paddock, XY } from '../types';
import { land } from './fixtures';

function rect(x: number, y: number, w: number, h: number): XY[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function paddock(id: string, ring: XY[]): Paddock {
  return { id, name: id, acres: 1, polygon: { localM: ring }, land: land(), history: [], availableCrops: [] };
}

describe('geometry', () => {
  it('finds shared edges and the side each neighbour is on', () => {
    const farm: Farm = {
      latitude: 42,
      paddocks: [
        paddock('south', rect(0, 0, 100, 50)),
        paddock('north', rect(0, 50, 100, 50)),
        paddock('east', rect(100, 0, 40, 50)),
      ],
    };
    const prep = prepareFarm(farm);
    const s = prep.adjacency['south']!;
    const n = s.find((x) => x.paddockId === 'north')!;
    expect(n.side).toBe('north');
    expect(n.sharedEdgeM).toBeCloseTo(100);
    expect(n.northEdgeM).toBeCloseTo(100);
    const e = s.find((x) => x.paddockId === 'east')!;
    expect(e.side).toBe('east');
    expect(e.northEdgeM).toBe(0);
    const back = prep.adjacency['north']!.find((x) => x.paddockId === 'south')!;
    expect(back.side).toBe('south');
    expect(back.northEdgeM).toBe(0);
    expect(prep.areaM2['south']).toBeCloseTo(5000);
  });

  it('handles clockwise rings and partial overlaps', () => {
    const cw = rect(0, 0, 100, 50).reverse();
    const farm: Farm = { latitude: 40, paddocks: [paddock('a', cw), paddock('b', rect(30, 50, 200, 20))] };
    const nb = prepareFarm(farm).adjacency['a']![0]!;
    expect(nb.sharedEdgeM).toBeCloseTo(70);
    expect(nb.northEdgeM).toBeCloseTo(70);
  });

  it('converts lng/lat polygons to local metres around the farm centre', () => {
    const local = lngLatToLocal(
      [
        [-93.0, 42.0],
        [-93.0, 42.001],
      ],
      [-93.0, 42.0],
    );
    expect(local[1]![1]).toBeCloseTo(111.2, 0); // ~111 m per 0.001 deg latitude
    const d = 0.0036; // ~ 300 m square-ish
    const farm: Farm = {
      latitude: 42,
      paddocks: [
        {
          ...paddock('a', []),
          polygon: { lngLat: [[-93, 42], [-93 + d, 42], [-93 + d, 42 + d], [-93, 42 + d]] },
        },
        {
          ...paddock('b', []),
          polygon: { lngLat: [[-93, 42 + d], [-93 + d, 42 + d], [-93 + d, 42 + 2 * d], [-93, 42 + 2 * d]] },
        },
      ],
    };
    const prep = prepareFarm(farm);
    expect(prep.adjacency['a']![0]!.side).toBe('north');
    expect(prep.areaM2['a']! / SQ_M_PER_ACRE).toBeGreaterThan(20);
  });

  it('rejects southern-hemisphere farms with a clear error', () => {
    expect(() => prepareFarm({ latitude: -33.9, paddocks: [] })).toThrow(/southern hemisphere/);
  });
});
