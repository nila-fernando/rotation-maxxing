// The jar test dialog's one pure rule (src/screens/jarPanel.js): this session's photo comes back
// for "See your jar" only while it made the record the field uses now.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { keptFor } = await import('./jarPanel.js');

describe('the jar test dialog', () => {
  it('keptFor: the session photo only while the field still uses the jar it made (an Undo leaves it behind)', () => {
    const jar1 = { fieldId: 'f2', at: '2026-11-15T10:00:00.000Z' };
    const jar2 = { fieldId: 'f2', at: '2026-11-15T10:05:00.000Z' };
    const kept2 = { img: {}, analysis: { layers: [] }, at: jar2.at };
    assert.equal(keptFor(kept2, jar2), kept2, 'the jar it made');
    assert.equal(keptFor(kept2, jar1), null, 'Undo put jar 1 back: the earlier jar shows, not jar 2');
    assert.equal(keptFor(kept2, null), null, 'no jar in use: a fresh start');
    assert.equal(keptFor(null, jar2), null);
    assert.equal(keptFor({ img: {} }, jar2), null, 'an entry with no record of its own');
  });
});
