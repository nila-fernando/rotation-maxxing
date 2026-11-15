import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { historyGap } from './fieldPanel.js';
import { buildFieldReport } from '../data/fieldReport.js';
import { lintLine } from '../plan/futuresVoice.js';

describe('the crop history gap line', () => {
  it('says how many years are on record', () => {
    assert.equal(historyGap(3), '3 of 8 years on record.');
    assert.equal(historyGap(0), 'No crop records for this field yet.');
  });
  it('on a site with no CropScape proxy, says honestly why the rest are missing, in Manami’s voice', () => {
    for (const n of [0, 1, 7]) {
      const line = historyGap(n, true);
      assert.match(line, /CropScape/);
      assert.deepEqual(lintLine(line), [], line);
    }
  });
  it('the report carries whether CropScape is out of reach', () => {
    assert.equal(buildFieldReport({ id: 'x', name: 'X' }, { cdl: false }).cdlOff, true);
    assert.equal(buildFieldReport({ id: 'x', name: 'X' }, { cdl: true }).cdlOff, false);
    assert.equal(buildFieldReport({ id: 'x', name: 'X' }).cdlOff, false, 'outside Vite the dev proxy is assumed');
  });
});
