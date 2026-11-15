import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startFarmLoad } from './farmLoad.js';
import { settledShare, statusText } from './loadStatus.js';
import { farmRunners } from './farmSources.js';

const fields = [{ id: 'a' }, { id: 'b' }];

describe('the farm’s data load', () => {
  it('reports each source as it settles, hands the data on, and settles everything', async () => {
    const got = [];
    const load = startFarmLoad({
      fields,
      point: [-93.6, 42],
      runners: {
        soil: async ({ field }) => { field('a', 'done', { t: 'loam' }); field('b', 'none', null, 'no soil survey here'); },
        rain: async ({ settle }) => settle('done', { avg30: 500 }),
        market: async ({ settle }) => settle('failed', null, 'USDA NASS could not be reached'),
      },
      onData: (key, v) => got.push([key, v]),
    });
    await load.whenSettled();
    assert.deepEqual(got, [['soil', { a: { t: 'loam' } }], ['rain', { avg30: 500 }]]);
    const soil = load.tracker.get('soil');
    assert.equal(soil.state, 'done');
    assert.equal(statusText(soil), '1 of 2 fields (no data for 1)');
    assert.equal(load.tracker.fieldState('soil', 'b').state, 'none');
    const market = load.tracker.get('market');
    assert.equal(market.state, 'failed');
    assert.equal(market.reason, 'USDA NASS could not be reached');
    assert.equal(statusText(market), 'Couldn’t reach USDA NASS');
    assert.equal(settledShare(load.tracker.all()), 1);
  });

  it('a runner that never answers is cut off at its budget, and a retry asks again', async () => {
    let tries = 0;
    const load = startFarmLoad({
      fields,
      point: null,
      budgets: { rain: 20 },
      runners: { rain: ({ settle }) => (++tries === 1 ? new Promise(() => {}) : settle('done', { avg30: 1 })) },
    });
    await load.whenSettled();
    assert.equal(load.tracker.get('rain').state, 'failed');
    assert.match(load.tracker.get('rain').reason, /took too long/);
    await load.retry('rain');
    assert.equal(load.tracker.get('rain').state, 'done');
    assert.equal(tries, 2);
  });

  it('the market row asks the markets’ status: done, none or failed', async () => {
    const markets = { status: async () => ({ state: 'failed', reason: 'this site has no connection to USDA NASS set up', retryable: false }) };
    const load = startFarmLoad({ fields, point: [-93.6, 42], runners: { market: farmRunners({ markets }).market } });
    await load.whenSettled();
    assert.equal(load.tracker.get('market').state, 'failed');
    assert.match(load.tracker.get('market').reason, /no connection to USDA NASS/);
  });
});
