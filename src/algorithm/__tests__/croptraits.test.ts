import { describe, expect, it } from 'vitest';
import { CROPS, DATA_GAPS, SEASONS, SOURCES, type HandbookState } from '../croptraits';
import { describeSource } from '../evidence';

describe('croptraits.ts (single data file)', () => {
  it('literal season spans match the raw Handbook 628 windows (plant.activeStart -> harvest.activeEnd)', () => {
    for (const c of CROPS) {
      const raw = SEASONS[c.id] ?? {};
      expect(Object.keys(c.season).sort()).toEqual(Object.keys(raw).sort());
      for (const [state, s] of Object.entries(raw)) {
        if (!s) continue;
        const start = s.plant ? (s.plant.activeStart ?? s.plant.begin) : (s.harvest.activeStart ?? s.harvest.begin);
        const end = s.harvest.activeEnd ?? s.harvest.end;
        const span = c.season[state as HandbookState]!;
        expect(span.plantMonth).toBe(Number(start.slice(0, 2)));
        expect(span.harvestMonth).toBe(Number(end.slice(0, 2)));
        expect(span.harvestDate).toBe(end);
        if (s.plant) expect(span.plantDate).toBe(start);
        expect(span.source).toBe('nassHandbook628');
      }
    }
  });

  it('every source id used by a crop row resolves', () => {
    for (const c of CROPS) {
      for (const field of [c.yieldPerAcre, c.pricePerUnit, c.operatingCostPerAcre, c.maxHeightM, c.kcMid, c.rootDepthM, c.salinity, c.nCreditToNextCornLbPerAcre]) {
        const src = field?.source;
        for (const id of src ? (Array.isArray(src) ? src : [src]) : []) expect(describeSource(id), `${c.id}: ${id}`).not.toBeNull();
      }
    }
    expect(SOURCES.nassHandbook628.url).toMatch(/esmis\.nal\.usda\.gov/);
    expect(SOURCES.faoEcocrop.note).toMatch(/expert opinion/);
  });

  it('keeps the update data gaps as literal strings', () => {
    expect(DATA_GAPS.some((g) => /Handbook 628 dates are from 2010/.test(g))).toBe(true);
    expect(DATA_GAPS.some((g) => /killing temperatures are unusable/.test(g))).toBe(true);
  });
});
