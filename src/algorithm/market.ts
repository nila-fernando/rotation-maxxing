/**
 * Stage 3: market pressure. Farm-wide production of a crop sells at the local
 * price up to local demand; the rest goes to the distant market at
 * (distant price - freight). This is why the whole farm doesn't go all-in on
 * the highest-priced crop.
 */
import { typicalPrice } from './cropData';
import type { CropTraits, Market } from './types';

export interface PriceInfo {
  localPrice: number;
  /** Distant price net of freight, never below 0 (you'd just not sell). */
  distantNetPrice: number;
  localDemand: number;
  fromMarket: boolean;
}

/** Prices for one crop. Null if the crop has no market entry and no sourced price. */
export function priceInfo(market: Market, crop: CropTraits): { info: PriceInfo | null; gap: string | null } {
  const m = market[crop.id];
  if (m) {
    const k = m.outlook ?? 1;
    return {
      info: {
        localPrice: m.localPrice * k,
        distantNetPrice: Math.max(0, m.distantPrice * k - m.freightPerUnit),
        localDemand: m.localDemand,
        fromMarket: true,
      },
      gap: null,
    };
  }
  const p = typicalPrice(crop);
  if (p === null) return { info: null, gap: null };
  return {
    info: { localPrice: p, distantNetPrice: p, localDemand: Infinity, fromMarket: false },
    gap: `No local market data for ${crop.name}; using the US average price with no demand cap.`,
  };
}

export interface SaleResult {
  revenue: number;
  localUnits: number;
  distantUnits: number;
  /** revenue / production ($ per unit); 0 if nothing produced. */
  effectivePrice: number;
}

/** Sell `production` units; `priceMultiplier` scales both prices (Monte Carlo price draws). */
export function sell(info: PriceInfo, production: number, priceMultiplier = 1): SaleResult {
  if (production <= 0) return { revenue: 0, localUnits: 0, distantUnits: 0, effectivePrice: 0 };
  const localUnits = Math.min(production, info.localDemand);
  const distantUnits = production - localUnits;
  const revenue = (localUnits * info.localPrice + distantUnits * info.distantNetPrice) * priceMultiplier;
  return { revenue, localUnits, distantUnits, effectivePrice: revenue / production };
}
