// "Manami's take" in the plans panel: on request, Claude (through the app's server, POST .../plan)
// picks a plan per field and says why, rotation first, profit second, with things to watch. She may
// give one field her own three seasons. Every number shown is the planner's own: her take is scored
// with evaluateMix before it is shown, and an own sequence the planner can't score is left out.
//
//   const take = createPlanTake({ endpoint, buildBody, evaluate })
//   take.mount(el, { data, save })   draws into el (hidden while the server has no 'plan' route)
//
// The section keeps its answer for the plans on show, so redrawing the panel doesn't ask again.
import { adviceFailLine, adviceRoutes, askAdvice, takeToPlan } from '../ai/advice.js';
import { money } from '../ui/money.js';
import { CROP_NAME, PLANS } from '../plan/planNames.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a speech bubble with a small spark: Manami thinking it over
export const TAKE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h11v9H9l-4 3v-3H4z" fill="currentColor" fill-opacity=".2"/><path d="M18.5 3v4M16.5 5h4M18 11.5v3M16.5 13h3"/></svg>';
const planName = (kind) => PLANS.find((p) => p.kind === kind)?.name || 'Manami’s pick';
const cropWords = (seq) => seq.map((s) => `${CROP_NAME[s.main] || s.main}${s.cover ? ` then ${(CROP_NAME[s.cover] || s.cover).toLowerCase()} over winter` : ''}`).join(', ');
const soil100 = (r) => { const v = r?.endSoilHealth ?? r?.soilHealth; return Number.isFinite(v) ? Math.round(v * 100) : null; };

/** The planner's numbers for a scored plan, said plainly (null when there are none). */
export function scoreLine(r) {
  if (!r || !Number.isFinite(r.expectedGM)) return null;
  const parts = [`About ${money(r.expectedGM)} over 3 seasons.`];
  if (Number.isFinite(r.p10GM)) parts.push(`In a bad year (1 in 10), about ${money(r.p10GM)}.`);
  const s = soil100(r);
  if (s != null) parts.push(`Soil health ${s} out of 100 at the end.`);
  return parts.join(' ');
}

/** The section's HTML for a state (pure, for the tests). */
export function takeHtml(state, data) {
  const ask = (label) => `<button class="btn btn--quiet btn--small plans__take-ask" type="button" data-take="ask">${TAKE_ICON}<span>${label}</span></button>`;
  if (state.status === 'loading') return '<p class="plans__take-wait" role="status"><span class="plans__spinner" aria-hidden="true"></span>Looking over your fields and the three plans…</p>';
  if (state.status === 'error') return `<p class="plans__take-line">${esc(adviceFailLine(state.error))}</p>${ask('Try again')}`;
  if (state.status !== 'done') {
    return `<p class="plans__take-line">Want my take? I’ll look at each field and tell you which plan I’d choose, and why.</p>${ask('Manami’s take')}`;
  }
  const t = state.take;
  const names = new Map(data.result.plans.priority.paddocks.map((p) => [p.paddockId, p.name]));
  const rows = t.fields.filter((f) => names.has(f.field_id)).map((f) => {
    const own = state.adjusted.has(f.field_id) ? `<span class="plans__take-own">My own three seasons: ${esc(cropWords(f.adjusted))}.</span>` : '';
    return `<li><b>${esc(names.get(f.field_id))}</b>: ${esc(state.adjusted.has(f.field_id) ? 'my own plan' : planName(f.pick))}. ${esc(f.why)} ${own}</li>`;
  }).join('');
  const risks = [
    ...t.risks.map((r) => (r.field_id && names.has(r.field_id) ? `${names.get(r.field_id)}: ${r.text}` : r.text)),
    ...(state.score?.risks || []).slice(0, 4).map((r) => `The planner flags: ${r}`),
  ];
  const nums = scoreLine(state.score);
  const pick = scoreLine(data.result.plans.priority);
  const numbers = nums
    ? `<p class="plans__take-nums"><b>The planner’s numbers for my take.</b> ${esc(nums)}</p>${pick ? `<p class="plans__take-nums plans__take-nums--vs">For comparison, Manami’s pick: ${esc(pick)}</p>` : ''}`
    : '<p class="plans__take-nums">I couldn’t get the planner’s numbers for this just now.</p>';
  const dropped = state.dropped ? '<p class="plans__take-note">The planner couldn’t score my own seasons, so I left them out.</p>' : '';
  return `${t.headline ? `<p class="plans__take-line">${esc(t.headline)}</p>` : ''}
    <ul class="plans__list plans__take-list">${rows}</ul>${dropped}${numbers}
    ${risks.length ? `<h4 class="rot-watch__h">Watch out</h4><ul class="plans__list plans__list--risk">${risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    <div class="plans__take-acts"><button class="btn btn--primary btn--small" type="button" data-take="use">Use my take</button>${ask('Ask again')}</div>
    <p class="plans__take-note">My words come from Claude, an AI, and can be wrong. The numbers are the planner’s own.</p>`;
}

export function createPlanTake({ endpoint, buildBody, evaluate, fetchImpl = globalThis.fetch }) {
  let state = { forResult: null, status: 'idle' };
  let el = null;
  let current = null; // { data, save }
  let seq = 0;

  const draw = () => {
    if (!el || !current) return;
    el.innerHTML = `<h3 class="plans__h">${TAKE_ICON}Manami’s take</h3>${takeHtml(state, current.data)}`;
  };

  async function ask() {
    const { data } = current;
    const id = ++seq;
    state = { forResult: data.result, status: 'loading' };
    draw();
    const res = await askAdvice(endpoint, 'plan', buildBody(), { fetchImpl });
    if (id !== seq || state.forResult !== data.result) return;
    if (res.error) { state = { forResult: data.result, status: 'error', error: res.error }; draw(); return; }
    let { plan, adjusted } = takeToPlan(res.take, data);
    let score = null, dropped = false;
    try { score = await evaluate(plan); } catch {
      if (adjusted.size) {
        ({ plan, adjusted } = takeToPlan(res.take, data, { withAdjusted: false }));
        dropped = true;
        try { score = await evaluate(plan); } catch { score = null; }
      }
    }
    if (id !== seq || state.forResult !== data.result) return;
    state = { forResult: data.result, status: 'done', take: res.take, plan, adjusted, score, dropped };
    draw();
    el?.querySelector('[data-take="use"]')?.focus({ preventScroll: true });
  }

  function onClick(e) {
    const b = e.target.closest?.('[data-take]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.take === 'ask') ask();
    else if (b.dataset.take === 'use' && state.status === 'done') current.save(state.plan);
  }

  function mount(host, { data, save }) {
    if (!host || !data?.result) return;
    el = host;
    current = { data, save };
    if (state.forResult !== data.result && state.status !== 'loading') state = { forResult: data.result, status: 'idle' };
    host.hidden = true;
    host.addEventListener('click', onClick);
    adviceRoutes(endpoint, { fetchImpl }).then((routes) => {
      if (el !== host || !routes.has('plan')) return;
      host.hidden = false;
      draw();
    });
  }

  return { mount, get state() { return state; } };
}
