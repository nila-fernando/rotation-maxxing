// Money as the farmer reads it: "$417k" on the cards, "about $25k" when Manami says it, "$73" an acre.
// Pure (no DOM), so the plans panel, the plan views and the tests share one way of writing it.

/** "$417k", "$1.2M", "−$12k", "$950". */
export function money(v) {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const sign = v < 0 && Math.round(a) > 0 ? '−' : '';
  // the unit is chosen from the rounded amount, so $999.6k reads "$1.0M", not "$1000k"
  if (a >= 1e6 || (a >= 1e4 && Math.round(a / 1e3) >= 1000)) {
    const m = a / 1e6;
    return `${sign}$${m >= 9.95 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
}

/**
 * Money rounded for saying out loud (and for the chips on the fields): "$25k", "$7k", "−$2k", "$640".
 * From $10k up it is money(); from $950 up, the nearest thousand; below that, the nearest ten.
 */
export function moneyAbout(v) {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e4) return money(v);
  if (a >= 950) return `${v < 0 ? '−' : ''}$${Math.round(a / 1e3)}k`;
  return money(Math.round(v / 10) * 10);
}

/** Dollars an acre, whole: "$73", "−$12". */
export function perAcre(v) {
  if (!Number.isFinite(v)) return '–';
  const a = Math.round(Math.abs(v));
  return `${v < 0 && a > 0 ? '−' : ''}$${a.toLocaleString('en-US')}`;
}
