// The words for the plans and the crops.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLANS, CROP_NAME, SPEECH, CROP_WORD, share, coverWord } from './planNames.js';
import { APP_CROP } from './farmInput.js';

describe('plan names', () => {
  it('names the three plans in order, and says each one', () => {
    assert.deepEqual(PLANS.map((p) => p.kind), ['current', 'maxProfit', 'priority']);
    assert.equal(PLANS[2].name, 'Manami’s pick');
    for (const k of [...PLANS.map((p) => p.kind), 'mix']) assert.ok(SPEECH[k], k);
    assert.equal(SPEECH.priority, 'my pick');
  });

  it('has a name and a spoken word for every crop the planner knows', () => {
    for (const id of Object.keys(APP_CROP)) {
      assert.ok(CROP_NAME[id], `name for ${id}`);
      const w = CROP_WORD[id];
      assert.ok(w && w.word && w.short && typeof w.plural === 'boolean', `word for ${id}`);
      assert.equal(w.word, w.word.toLowerCase(), `${id} is spoken in lower case`);
    }
    assert.deepEqual(CROP_WORD.soybeans, { word: 'soybeans', short: 'beans', plural: true });
    assert.equal(CROP_WORD.corn.plural, false);
  });

  it('turns a share into words', () => {
    assert.equal(share(95), 'nearly all');
    assert.equal(share(90), 'nearly all');
    assert.equal(share(75), 'about three-quarters');
    assert.equal(share(65), 'about two-thirds');
    assert.equal(share(50), 'about half');
    assert.equal(share(35), 'about a third');
    assert.equal(share(25), 'about a quarter');
    assert.equal(share(12), '12%');
    assert.equal(share(64.6), 'about two-thirds');
  });

  it('turns ground cover into words', () => {
    assert.equal(coverWord(24), 'a quarter');
    assert.equal(coverWord(48), 'half');
    assert.equal(coverWord(8), '8%');
  });
});
