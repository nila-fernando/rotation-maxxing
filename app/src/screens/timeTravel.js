// The year selector along the top of the hub, and the play-through.
//
//   [season icon  Fall 2026] [2018 2019 ... 2025 Now] [play]
//
// Choosing a year shows every field's crop that year, at the height of summer. "Now" is today's
// season (and Halloween or Christmas when it's that time), with the newest crops on record. Play
// runs the farm from the chosen year (or 2018) through every season to now: crops sprout, grow,
// ripen and get cut, leaves turn, snow falls (just the seasons: the festivals come with today's
// date or the theme picker). Choosing a year, pressing pause or Esc stops it.
//
//   const tt = createTimeTravel({ hub, onYear })
//   tt.show(island, { history, today })   history: Map id -> [{ year, key, label }] (2018–2025)
//   tt.hide()
import { CROP_STYLE } from '../island/crops.js';
import { createCropYears } from '../island/cropYears.js';
import { createDayNight } from '../island/dayNight.js';
import { formatHour } from '../island/daylight.js';
import { createDecor } from '../island/decor.js';
import { createSeasons } from '../island/seasons.js';
import { createThemes, THEME_NAMES, THEMES } from '../island/themes/index.js';
import { createPlayback, frostLook, nowState, occasionOn, occasionState, seasonAt, SEASON_NAMES, SEASONS, seasonState, staticState } from '../island/timeline.js';
import { SEASON_ICONS } from '../ui/season.js';
import { blendFor } from '../island/weather.js';
import { createWeatherRow } from './weatherRow.js';

const ICONS = {
  ...SEASON_ICONS,
  halloween: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5c-1.2-.9-3.6-1.1-5.4.2C4.4 8.3 4 11.4 4.6 14c.7 3 3 5.4 7.4 5.4s6.7-2.4 7.4-5.4c.6-2.6.2-5.7-2-7.3-1.8-1.3-4.2-1.1-5.4-.2z" fill="currentColor"/><path d="M12 6.5c0-1.6.6-2.8 2-3.5" fill="none" stroke="#6f7f3a" stroke-width="1.8" stroke-linecap="round"/><path d="M8.3 11l1.6-1.6 1 1.9zM15.7 11l-1.6-1.6-1 1.9zM8 14.2l1.4 1.2 1.3-1 1.3 1 1.3-1 1.3 1 1.4-1.2-.8 2.3H8.8z" fill="#ffe08a"/></svg>',
  christmas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.1 2.3 2.5.3-1.8 1.7.5 2.5L12 8.1l-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z" fill="#f2c14e"/><path d="M12 8.5l4.5 5h-2l3.5 4.5H6l3.5-4.5h-2z" fill="currentColor"/><rect x="10.7" y="18" width="2.6" height="3" rx=".6" fill="#8a6a4f"/><circle cx="10" cy="15.6" r=".9" fill="#ff6b5e"/><circle cx="14.2" cy="12.6" r=".9" fill="#5aa0ff"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
};
// the time of day: the sun, the sun on the horizon (dawn and dusk), the moon
const DAY_ICONS = {
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6" fill="#f5b52e"/><g stroke="#f5b52e" stroke-width="2.2" stroke-linecap="round"><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5"/></g></svg>',
  twilight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 16.5a5.4 5.4 0 0 1 10.8 0z" fill="#f08a4b"/><g stroke="#f08a4b" stroke-width="2.1" stroke-linecap="round"><path d="M12 6.2v2.1M4.9 9.4l1.4 1.4M19.1 9.4l-1.4 1.4M2.8 16.5h2M19.2 16.5h2"/></g><path d="M3.5 19.6h17" stroke="#8a6a4f" stroke-width="2.1" stroke-linecap="round"/></svg>',
  night: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 3.6a8.6 8.6 0 1 0 4.8 13.3 7 7 0 0 1-4.8-13.3z" fill="#8c95e8"/><circle cx="18.6" cy="5.4" r="1" fill="#8c95e8"/><circle cx="20.6" cy="9.4" r=".7" fill="#8c95e8"/></svg>',
};
const dayIconFor = (info) => (info.night > 0.6 ? 'night' : info.part === 'Dawn' || info.part === 'Dusk' ? 'twilight' : 'day');
Object.assign(ICONS, {
  easter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3.3 0 6.2 5 6.2 9.4A6.2 6.2 0 0 1 12 19 6.2 6.2 0 0 1 5.8 12.4C5.8 8 8.7 3 12 3z" fill="currentColor"/><path d="M6.4 10.6l2 1.4 2-1.4 2 1.4 2-1.4 2 1.4 1.3-.9" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9.4" cy="15" r="1" fill="#fff"/><circle cx="14.6" cy="15" r="1" fill="#fff"/></svg>',
  independence: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18" stroke="#8a6a4f" stroke-width="2" stroke-linecap="round"/><path d="M6 4h13v10H6z" fill="#f5f2ea"/><path d="M6 4h13v1.6H6zM6 7.2h13v1.6H6zM6 10.4h13V12H6z" fill="#c8363c"/><path d="M6 4h6v5.2H6z" fill="#2f4f9a"/></svg>',
  thanksgiving: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 9c-1.4-1-2-2.7-1.6-4.4C12 5.2 12.9 7 12 9zM12 12c-1.8-.4-3.2-1.7-3.6-3.5 1.9.2 3.3 1.6 3.6 3.5zM12 12c1.8-.4 3.2-1.7 3.6-3.5-1.9.2-3.3 1.6-3.6 3.5zM12 15.4c-1.8-.4-3.2-1.7-3.6-3.5 1.9.2 3.3 1.6 3.6 3.5zM12 15.4c1.8-.4 3.2-1.7 3.6-3.5-1.9.2-3.3 1.6-3.6 3.5z" fill="currentColor"/></svg>',
  newyear: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></g><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
});
const OCCASION_NAME = { halloween: 'Halloween', christmas: 'Christmas', easter: 'Easter', independence: 'July 4th', thanksgiving: 'Thanksgiving', newyear: 'New Year' };
/** "New Year 2027" (the year it starts), "Easter 2026". */
const occasionLabel = (state) => `${OCCASION_NAME[state.occasion]} ${state.occasion === 'newyear' ? state.year + 1 : state.year}`;
const CROP_NAMES = { corn: 'Corn', soybeans: 'Soybeans', wheat: 'Wheat', barley: 'Barley', oats: 'Oats', sorghum: 'Sorghum', alfalfa: 'Alfalfa', hay: 'Hay', pasture: 'Pasture', fallow: 'Fallow', other: 'Other' };
const cropName = (key) => CROP_NAMES[key] || CROP_STYLE[key]?.label || 'No crop';

/**
 * @param {object} o
 * @param {object} o.hub   the hub (setRowCrop, overview)
 * @param {(info: {year: number|null, now: boolean, state: object}) => void} [o.onYear]  the shown year changed
 */
export function createTimeTravel({ hub, onYear } = {}) {
  const $ = (id) => document.getElementById(id);
  const bar = $('timebar');
  const label = $('timeLabel');
  const yearsEl = $('timeYears');
  const playBtn = $('timePlay');
  const prevBtn = $('timePrev');
  const nextBtn = $('timeNext');
  const dayBtn = $('timeDay');
  const dayPop = $('dayPop');
  const daySlider = $('daySlider');
  const dayRun = $('dayRun');
  const dayNowBtn = $('dayNow');
  const daySeasons = $('daySeasons');
  const dayThemes = $('dayThemes');
  let session = null;

  function show(island, opts) {
    hide();
    if (!island?.view) return;
    session = start(island, opts);
  }

  function hide() {
    session?.dispose();
    session = null;
    bar.hidden = true;
  }

  function start(island, { history, today = new Date(), hour = null, liveDate = false, weather = null }) {
    const { view } = island;
    const offs = [];
    const years = [...new Set([...history.values()].flatMap((h) => h.map((x) => x.year)))].sort((a, b) => a - b);
    const latest = years[years.length - 1];
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    // each field's crop key and name per year; "now" is what the island showed at the reveal
    const keysFor = (year) => {
      const m = new Map();
      for (const f of view.fields) {
        const h = history.get(f.id)?.find((x) => x.year === year);
        m.set(f.id, year == null ? f.cropKey : h?.key || 'fallow');
      }
      return m;
    };

    const seasons = createSeasons(view);
    const crops = createCropYears({ fields: view.fields, onBuilt: (p) => seasons.attach(p) });
    const decor = createDecor(view, { attach: (o) => seasons.attach(o) });
    seasons.attach(decor.root);
    offs.push(() => { decor.dispose(); crops.dispose(); seasons.dispose(); });
    crops.prebuild(years.map(keysFor)); // every year's paddocks, ahead of time, while idle
    // the time of day: the real one, from the clock on the wall (or held at ?hour=, for demos)
    const dayNight = createDayNight(view, { seasons, lamps: view.lamps || [], mode: hour == null ? 'live' : 'hold', hour: hour ?? 12 });
    offs.push(() => dayNight.dispose());
    // the festival themes: the whole farm dressed up (built the first time each is wanted)
    const themes = createThemes(view, { attach: (o) => seasons.attach(o) });
    offs.push(() => themes.dispose());
    // the farm's weather (src/island/weatherState.js: live, or a look picked to preview), mixed in on
    // top of the season, festival and time of day
    if (weather) {
      seasons.setWeather(blendFor(weather.state), { instant: reduced() });
      offs.push(weather.subscribe((s) => { seasons.setWeather(blendFor(s), { instant: reduced() }); paintDay(true); }));
    }

    // ---------------------------------------------------------------- the bar
    yearsEl.replaceChildren(...[...years, 'now'].map((y) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'timebar__year';
      b.setAttribute('role', 'radio');
      b.dataset.year = String(y);
      b.textContent = y === 'now' ? 'Now' : String(y);
      b.setAttribute('aria-label', y === 'now' ? 'Now' : `${y} crops`);
      return b;
    }));
    bar.hidden = false;

    let mode = 'now'; // 'now' | a year | 'playing' | 'paused' | 'preview' (a planned season)
    let previewLabel = '';
    let shownCropYear = undefined;
    let playback = null;
    let playT = 0;
    let current = null;

    // what's on the bar now: render() only touches what changed (it runs every frame while playing)
    const shown = {};
    function render(state) {
      current = state;
      const look = state.occasion || state.season;
      const playing = mode === 'playing';
      const text = mode === 'preview' ? `${state.year} · ${previewLabel}`
        : state.occasion ? occasionLabel(state) : state.now || mode === 'playing' || mode === 'paused' ? state.label : `${state.year} crops`;
      bar.classList.toggle('is-preview', mode === 'preview'); // a wider label for "2027 · Manami's pick"
      if (shown.look !== look) {
        shown.look = look;
        label.innerHTML = `${ICONS[look]}<span></span>`;
        label.dataset.look = look;
        shown.text = null;
      }
      if (shown.text !== text) { shown.text = text; label.lastChild.textContent = text; }
      // while playing the label changes every moment: don't read each one out
      const live = playing ? 'off' : 'polite';
      if (label.getAttribute('aria-live') !== live) label.setAttribute('aria-live', live);
      const active = mode === 'preview' ? 'preview' : state.now ? 'now' : String(state.year);
      if (shown.active !== active) {
        shown.active = active;
        // a planned year isn't one of the buttons: none is checked, but "Now" keeps the year list in the tab order
        const focusable = active === 'preview' ? 'now' : active;
        for (const b of yearsEl.children) {
          b.setAttribute('aria-checked', String(b.dataset.year === active));
          b.tabIndex = b.dataset.year === focusable ? 0 : -1;
        }
      }
      const paused = mode === 'paused';
      if (shown.playing !== playing) {
        shown.playing = playing;
        playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
        playBtn.classList.toggle('is-playing', playing);
        bar.classList.toggle('is-playing', playing);
      }
      if (shown.paused !== paused) {
        shown.paused = paused;
        bar.classList.toggle('is-paused', paused);
      }
      // the button's name and tooltip follow both (playing, paused, or neither)
      const name = playing ? 'Pause' : paused ? 'Resume' : 'Play the farm through the years';
      if (shown.name !== name) {
        shown.name = name;
        playBtn.setAttribute('aria-label', name);
        playBtn.title = playing ? 'Pause (Space)' : paused ? 'Resume (Space)' : name;
      }
      const idx = years.indexOf(state.now ? null : state.year);
      const prevOff = !years.length || (!state.now && idx === 0); // a planned year (not on record) can step back to the latest
      const nextOff = !!state.now;
      if (prevBtn.disabled !== prevOff) prevBtn.disabled = prevOff;
      if (nextBtn.disabled !== nextOff) nextBtn.disabled = nextOff;
      if (playBtn.disabled !== !years.length) playBtn.disabled = !years.length; // no crop years: nothing to play
    }

    function apply(state, { instant = false, keys = null, empty = null, grow = null, stagger } = {}) {
      // winter days are short, summer ones long (not during a play-through: the seasons fly by
      // there, and the day would flicker between dusk and dark with each one)
      if (mode !== 'playing' && mode !== 'paused') dayNight.setSeason(state.season);
      themes.setTheme(state.occasion, { year: state.year }); // the festival's things all over the farm
      if (instant) themes.snap();
      if (keys) {
        // a planned season: these crops, whatever the year
        shownCropYear = `plan:${state.year}:${previewLabel}`;
        crops.setYear(keys);
        for (const f of view.fields) {
          const none = empty?.has(f.id); // a season not planned yet (bare ground on the island)
          hub.setRowCrop?.(f.id, { key: none ? null : keys.get(f.id) || null, label: none ? 'Not planned yet' : cropName(keys.get(f.id)), year: state.year });
        }
        onYear?.({ year: null, now: false, state });
        crops.setSize(state.look.growth);
        // the fields that changed sprout back up (one after another), unless motion is reduced
        if (grow?.length && !reduced()) crops.growIn(grow, stagger == null ? {} : { stagger });
        seasons.setState(state, { instant });
        decor.setState(state);
        render(state);
        return;
      }
      // off a plan view: anything still sprouting from it goes straight to full size, so today's
      // crops (or a past year's, or a play-through's) don't show up small and grow in again
      crops.cancelGrow();
      const cropYear = state.now ? null : Math.min(state.cropYear, latest);
      if (cropYear !== shownCropYear) {
        shownCropYear = cropYear;
        crops.setYear(keysFor(cropYear));
        for (const f of view.fields) {
          const h = cropYear == null ? null : history.get(f.id)?.find((x) => x.year === cropYear);
          hub.setRowCrop?.(f.id, cropYear == null ? null : { key: h?.key || null, label: h?.label || 'No record', year: cropYear });
        }
        onYear?.({ year: cropYear, now: !!state.now, state });
      }
      crops.setSize(state.look.growth);
      seasons.setState(state, { instant });
      decor.setState(state);
      render(state);
    }

    // the season on show: today's real one (and a past year's summer) unless the farmer picked one;
    // the festival theme: today's (by the calendar) unless the farmer picked one, or none
    let seasonPick = null;
    let themePick = 'auto'; // 'auto' | 'none' | a festival key
    const stateFor = (year) => {
      const now = year === 'now';
      const y = now ? seasonAt(today).year : year;
      if (themePick !== 'auto' && themePick !== 'none') return occasionState(y, themePick, now ? { now: true, cropYear: latest } : {});
      // (picking today's own season is just today: its festival stays)
      const real = now && (!seasonPick || seasonPick === seasonAt(today).season);
      const st = now
        ? (real ? nowState(today, latest) : seasonState(y, seasonPick, { now: true, cropYear: latest }))
        : (seasonPick ? seasonState(year, seasonPick) : staticState(year));
      return themePick === 'none' && st.occasion ? { ...st, occasion: null } : st;
    };

    function select(year) {
      mode = year === 'now' ? 'now' : year;
      playback = null;
      apply(stateFor(year), { instant: reduced() });
    }

    /**
     * Shows a planned season on the island: { label, keysByYear: [Map id -> crop key], startYear,
     * emptyByYear?: [Set of field ids not planned yet] }, year index i.
     * opts.grow: field ids whose crops sprout back up as they show (in that order, opts.stagger
     * seconds apart; see cropYears.growIn). Showing it again (a season or festival picked) doesn't.
     * opts.frost: a spring freeze that season, so a light rime of frost lies on the farm
     * (timeline.frostLook). It only raises the snow: the season and any festival stay as they are,
     * and it stays on when the season or festival is picked again.
     */
    let lastPreview = null;
    function preview(info, i = 0, { grow = null, stagger, frost = false } = {}) {
      const { label, keysByYear, startYear, emptyByYear } = info;
      lastPreview = { info, i, frost };
      mode = 'preview';
      playback = null;
      previewLabel = label;
      // the picked season or festival dresses the farm, but the planned crops always show grown
      // (a winter or a cut-down Thanksgiving would hide what's being planned)
      const st = stateFor(startYear + i), grown = staticState(startYear + i).look;
      const planned = { ...st.look, growth: grown.growth, harvested: false, ripe: Math.min(st.look.ripe, grown.ripe) };
      const look = frost ? frostLook(planned) : planned;
      apply({ ...st, look }, { instant: reduced(), keys: keysByYear[i], empty: emptyByYear?.[i] || null, grow: grow ? [...grow] : null, stagger });
    }

    /** Shows the farm in another season (null: back to the real one), staying on the same year. */
    function pickSeason(s) {
      if ((s || null) === (current?.season || null) && themePick === 'auto' && mode !== 'playing' && mode !== 'paused') return; // already on show
      seasonPick = s || null;
      if (themePick !== 'auto' && themePick !== 'none') themePick = 'auto'; // a season of its own, not the festival's
      reshow();
    }
    /** Dresses the farm for a festival ('auto': whatever the calendar says; 'none': no festival). */
    function pickTheme(key) {
      themePick = key || 'auto';
      if (themePick !== 'auto' && themePick !== 'none') seasonPick = null; // the festival brings its season
      reshow();
    }
    function reshow() {
      if (mode === 'preview' && lastPreview) preview(lastPreview.info, lastPreview.i, { frost: lastPreview.frost });
      else if (typeof mode === 'number') select(mode);
      else select('now'); // (a play-through stops: it runs through every season itself)
    }

    function play() {
      if (mode === 'paused' && playback) { mode = 'playing'; render(current); return; }
      if (!years.length) return; // no crop history on record: nothing to play through
      playback = createPlayback(years);
      const from = typeof mode === 'number' && mode !== latest ? mode : years[0];
      playT = playback.startOf(from);
      mode = 'playing';
      hub.overview?.(); // the whole farm, panel closed
      apply(playback.at(playT));
    }

    function pause() {
      if (mode !== 'playing') return;
      mode = 'paused';
      // hold exactly this moment: colours and decorations finish arriving now, then nothing moves
      // (falling snow and leaves, bats, twinkling lights all stop until play is pressed again)
      seasons.setState(current, { instant: true });
      decor.snap();
      themes.snap();
      render(current);
    }

    // ---- events
    const onYearClick = (e) => {
      const b = e.target.closest('.timebar__year');
      if (!b) return;
      select(b.dataset.year === 'now' ? 'now' : Number(b.dataset.year));
    };
    const onYearKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const btns = [...yearsEl.children];
      let i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      i = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : Math.max(0, Math.min(btns.length - 1, i + (fwd ? 1 : -1)));
      e.preventDefault();
      btns[i].click();
      btns[i].focus();
    };
    const step = (dir) => {
      const had = document.activeElement;
      const at = current?.now ? years.length : years.indexOf(current?.year);
      const i = Math.max(0, Math.min(years.length, (at < 0 ? years.length : at) + dir));
      select(i >= years.length ? 'now' : years[i]);
      // an arrow that just reached its end disables itself: hand focus to the other one
      if ((had === prevBtn || had === nextBtn) && had.disabled) (had === prevBtn ? nextBtn : prevBtn).focus();
    };
    const onPrev = () => step(-1);
    const onNext = () => step(1);
    // The one button toggles, so guard against it undoing itself: the second click of a double
    // click, a held key's repeats, and a click that lands just after the play-through ended by
    // itself (meant as "pause", it would otherwise start it all over again).
    let lastToggle = 0;
    let endedAt = -1e9;
    const onPlay = (e) => {
      const now = performance.now();
      if (e?.detail > 1) return;
      if (now - lastToggle < 280) return;
      if (mode === 'now' && now - endedAt < 700) return;
      lastToggle = now;
      if (mode === 'playing') pause(); else play();
    };
    const onPlayKey = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.repeat) e.preventDefault(); };
    // Esc leaves the play-through, but text boxes keep Esc for themselves, and an open field
    // check-up closes first (the hub handles that; a second Esc then leaves the play-through)
    // Space pauses and resumes from anywhere during the play-through (unless a control has focus,
    // which Space already presses)
    const onKey = (e) => {
      if (mode !== 'playing' && mode !== 'paused') return;
      if (!dayPop.hidden) return; // the time-of-day popover is open: its Esc closes it
      if (document.body.classList.contains('plans-open') || e.target.closest?.('#plans, [role="dialog"]')) return; // the plans keep their own keys
      if (e.target.closest?.('textarea, select, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=button])')) return;
      if (e.key === ' ' && !e.repeat && !e.target.closest?.('button, a, input, summary, [role="radio"], [tabindex]')) {
        e.preventDefault();
        onPlay();
        return;
      }
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('checkup-open')) return;
      e.preventDefault();
      select('now');
    };
    yearsEl.addEventListener('click', onYearClick);
    yearsEl.addEventListener('keydown', onYearKey);
    prevBtn.addEventListener('click', onPrev);
    nextBtn.addEventListener('click', onNext);
    playBtn.addEventListener('click', onPlay);
    playBtn.addEventListener('keydown', onPlayKey);
    addEventListener('keydown', onKey, true);
    offs.push(() => {
      yearsEl.removeEventListener('click', onYearClick);
      yearsEl.removeEventListener('keydown', onYearKey);
      prevBtn.removeEventListener('click', onPrev);
      nextBtn.removeEventListener('click', onNext);
      playBtn.removeEventListener('click', onPlay);
      playBtn.removeEventListener('keydown', onPlayKey);
      removeEventListener('keydown', onKey, true);
    });

    // ---- the time of day and the season: a sun or moon button on the bar, and under it a slider
    // for the hour, the four seasons, "Play the day" / "Pause the day", and "Back to today" (the
    // real time and season again). The island starts at the real time and season.
    const dayShown = {};
    const SEASON_OF = { live: ' · now', play: ' · playing', hold: '' };
    daySeasons.innerHTML = SEASONS.map((s) => `<button type="button" role="radio" class="daypop__season" data-season="${s}" aria-checked="false" tabindex="-1">${ICONS[s]}<span>${SEASON_NAMES[s]}</span></button>`).join('');
    // the festival themes: by the calendar (the default), none, or any of them
    const THEME_ICON = {
      auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="15" r="2" fill="currentColor"/></svg>',
      none: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.8 17.2L17.2 6.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      ...Object.fromEntries(THEMES.map((k) => [k, ICONS[k]])),
    };
    const THEME_LABEL = { auto: 'By date', none: 'None', ...THEME_NAMES };
    dayThemes.innerHTML = ['auto', 'none', ...THEMES].map((k) => `<button type="button" role="radio" class="daypop__theme" data-theme="${k}" aria-checked="false" tabindex="-1">${THEME_ICON[k]}<span>${THEME_LABEL[k]}</span></button>`).join('');
    // the weather: Live (the default) or a look to preview (src/screens/weatherRow.js)
    const weatherRow = weather ? createWeatherRow({ el: $('dayWeather'), credit: $('dayWeatherCredit'), weather, onPick: () => paintDay(true) }) : null;
    offs.push(() => weatherRow?.dispose());
    function paintDay(force = false) {
      const info = dayNight.info;
      const time = formatHour(dayNight.hour);
      const icon = dayIconFor(info);
      const how = dayNight.mode;
      const shownSeason = current?.season || null;
      const real = how === 'live' && !seasonPick && themePick === 'auto' && !weather?.state.picked;
      if (force || dayShown.icon !== icon) { dayShown.icon = icon; dayBtn.innerHTML = DAY_ICONS[icon]; $('dayIcon').innerHTML = DAY_ICONS[icon]; }
      if (force || dayShown.time !== time || dayShown.how !== how || dayShown.part !== info.part || dayShown.season !== shownSeason || dayShown.real !== real || dayShown.theme !== themePick) {
        Object.assign(dayShown, { time, how, part: info.part, season: shownSeason, real, theme: themePick });
        weatherRow?.paint();
        // the themes: which is picked, and what "By date" means today
        const byDate = occasionOn(today);
        for (const b of dayThemes.children) {
          const on = b.dataset.theme === themePick;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
          if (b.dataset.theme === 'auto') {
            const what = byDate ? THEME_NAMES[byDate] : 'no festival today';
            b.title = `Follows the calendar: ${what}`;
            b.setAttribute('aria-label', `By date (${what})`);
          }
        }
        const name = `Time and season: ${time}, ${info.part.toLowerCase()}${how === 'live' ? ' (now)' : how === 'play' ? ' (playing through the day)' : ''}`;
        dayBtn.setAttribute('aria-label', name);
        dayBtn.title = name;
        $('dayTime').textContent = time;
        $('dayPart').textContent = `${info.part}${SEASON_OF[how]}`;
        dayRun.textContent = how === 'play' ? 'Pause the day' : 'Play the day';
        dayNowBtn.disabled = real;
        // the slider follows the clock (not while it's being dragged: it set the hour itself)
        if (document.activeElement !== daySlider || how !== 'hold') daySlider.value = String(Math.round(dayNight.hour * 4) / 4);
        daySlider.setAttribute('aria-valuetext', `${time}, ${info.part.toLowerCase()}`);
        for (const b of daySeasons.children) {
          const on = b.dataset.season === shownSeason;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on || (!shownSeason && b === daySeasons.firstElementChild) ? 0 : -1;
        }
      }
    }
    const dayOpen = () => !dayPop.hidden;
    function setDayOpen(open, { focus = true } = {}) {
      if (open === dayOpen()) return;
      dayPop.hidden = !open;
      dayBtn.setAttribute('aria-expanded', String(open));
      bar.classList.toggle('is-daypop', open);
      if (open) { paintDay(true); if (focus) daySlider.focus({ preventScroll: true }); }
      else if (focus && dayPop.contains(document.activeElement)) dayBtn.focus({ preventScroll: true });
    }
    const onDayBtn = () => setDayOpen(!dayOpen());
    const onSlide = () => {
      dayNight.setHour(Number(daySlider.value)); // the farmer picked an hour: it holds there
      paintDay(true);
    };
    const onDayRun = () => { dayNight.setMode(dayNight.mode === 'play' ? 'hold' : 'play'); paintDay(true); };
    const onDayNow = () => {
      dayNight.setMode('live');
      weather?.pick(null); // (the real weather again too)
      if (seasonPick || themePick !== 'auto') { seasonPick = null; themePick = 'auto'; reshow(); }
      paintDay(true);
      dayRun.focus({ preventScroll: true }); // (this button just turned itself off)
    };
    const onSeasonPick = (e) => {
      const b = e.target.closest('.daypop__season');
      if (!b) return;
      pickSeason(b.dataset.season);
      paintDay(true);
    };
    const onThemePick = (e) => {
      const b = e.target.closest('.daypop__theme');
      if (!b) return;
      pickTheme(b.dataset.theme);
      paintDay(true);
    };
    // arrow keys move along either radio group (seasons or themes)
    const onSeasonKey = (e) => {
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const btns = [...e.currentTarget.children];
      const i = Math.max(0, btns.findIndex((b) => b.getAttribute('aria-checked') === 'true'));
      const next = btns[(i + step + btns.length) % btns.length];
      next.click();
      next.focus();
    };
    const onDayKey = (e) => {
      if (e.key !== 'Escape' || !dayOpen()) return;
      e.preventDefault();
      e.stopPropagation(); // just the popover: not the play-through or the hub
      setDayOpen(false);
    };
    const onDayOutside = (e) => { if (dayOpen() && !e.target.closest?.('.timebar__daywrap')) setDayOpen(false, { focus: false }); };
    // keyboard focus moving on to something else closes it too (not a click on the canvas: that's
    // handled above, and focus doesn't go anywhere then)
    const onDayBlur = (e) => { if (dayOpen() && e.relatedTarget && !dayBtn.parentElement.contains(e.relatedTarget)) setDayOpen(false, { focus: false }); };
    dayBtn.parentElement.addEventListener('focusout', onDayBlur);
    offs.push(() => dayBtn.parentElement.removeEventListener('focusout', onDayBlur));
    dayBtn.addEventListener('click', onDayBtn);
    daySlider.addEventListener('input', onSlide);
    dayRun.addEventListener('click', onDayRun);
    dayNowBtn.addEventListener('click', onDayNow);
    daySeasons.addEventListener('click', onSeasonPick);
    daySeasons.addEventListener('keydown', onSeasonKey);
    dayThemes.addEventListener('click', onThemePick);
    dayThemes.addEventListener('keydown', onSeasonKey);
    dayBtn.parentElement.addEventListener('keydown', onDayKey);
    addEventListener('pointerdown', onDayOutside, true);
    offs.push(() => {
      setDayOpen(false, { focus: false });
      dayBtn.removeEventListener('click', onDayBtn);
      daySlider.removeEventListener('input', onSlide);
      dayRun.removeEventListener('click', onDayRun);
      dayNowBtn.removeEventListener('click', onDayNow);
      daySeasons.removeEventListener('click', onSeasonPick);
      daySeasons.removeEventListener('keydown', onSeasonKey);
      dayThemes.removeEventListener('click', onThemePick);
      dayThemes.removeEventListener('keydown', onSeasonKey);
      dayBtn.parentElement.removeEventListener('keydown', onDayKey);
      removeEventListener('pointerdown', onDayOutside, true);
    });
    paintDay(true);

    // ---- every frame
    let time = 0;
    // past midnight the date moves on (and with it the season and festival), unless a date was set
    const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let dateCheck = 0;
    const checkDate = (dt) => {
      if (!liveDate || (dateCheck += dt) < 30) return;
      dateCheck = 0;
      const d = new Date();
      if (dayKey(d) === dayKey(today)) return;
      today = d;
      if (mode === 'now') select('now'); // (a past year or a preview stays; "Now" will be the new day)
      paintDay(true);
    };
    const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    let reducedNow = motionQuery.matches;
    const onMotion = () => { reducedNow = motionQuery.matches; };
    motionQuery.addEventListener('change', onMotion);
    offs.push(() => motionQuery.removeEventListener('change', onMotion));
    offs.push(view.onFrame((dt) => {
      if (mode === 'playing' && playback) {
        playT += dt;
        if (playT >= playback.duration) { endedAt = performance.now(); select('now'); }
        else apply(playback.at(playT));
      }
      crops.tick(dt); // crops sprouting back up in a plan view (nothing to do otherwise)
      // the seasons' own clock (falling snow, bats, twinkling) stops while paused, and so does the day
      const live = mode !== 'paused';
      if (live) time += dt;
      dayNight.update(live ? dt : 0); // before the seasons, which mix the time of day into their light
      decor.setNight(dayNight.info.night); // (fireworks shine brighter in the dark)
      themes.update(live ? dt : 0, time, { night: dayNight.info.night });
      seasons.update(live ? dt : 0, time);
      decor.update(live ? dt : 0, time);
      // the windmill's sails turn in the breeze (a touch faster in the windy months, and with the
      // weather's wind; not at all when motion is reduced)
      if (live && view.spinners?.length && !reducedNow) {
        const wind = (current?.season === 'winter' || current?.season === 'fall' ? 0.85 : 0.6) * (1 + 2.6 * seasons.wind);
        for (const b of view.spinners) b.rotation.z += dt * wind;
      }
      paintDay();
      checkDate(dt);
    }));

    select('now');

    return {
      select,
      play,
      pause,
      preview,
      /** Builds these crop layouts ([Map id -> crop key]) in idle time, so showing them later is instant. */
      prebuild: (keyMaps) => crops.prebuild(keyMaps),
      /** fn() with the festival on show at its full size (themes.atFull): for measuring what it fills. */
      atFullTheme: (fn) => themes.atFull(fn),
      /** Jumps the play-through to `seconds` (for testing in the console). */
      seek(seconds) { if (!playback) play(); playT = Math.max(0, Math.min(playback.duration - 0.01, seconds)); apply(playback.at(playT)); },
      get mode() { return mode; },
      get state() { return current; },
      /** The time of day now (dayNight.info: hour, night, golden, morning...), for the farm's sounds. */
      get dayInfo() { return dayNight.info; },
      get playback() { return playback; },
      dispose() {
        offs.reverse().forEach((fn) => fn());
        yearsEl.replaceChildren();
      },
    };
  }

  return {
    show,
    hide,
    select: (y) => session?.select(y),
    preview: (info, i, opts) => session?.preview(info, i, opts),
    prebuild: (keyMaps) => session?.prebuild(keyMaps),
    play: () => session?.play(),
    pause: () => session?.pause(),
    get session() { return session; },
  };
}
