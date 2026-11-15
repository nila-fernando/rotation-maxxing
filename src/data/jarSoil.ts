/**
 * Jar test -> planner soil. The farmer's soil-jar photo (src/jar-test) gives
 * sand / silt / clay %, which replaces SSURGO's map-based surface texture for
 * that field. Precedence: texture typed in by the farmer > jar test > SSURGO.
 *
 * Only texture is taken. The jar's drainage and water-holding strings are
 * general guidance per texture class, its organic-matter figure is a share of
 * jar height (not % by weight), and SSURGO drainage reflects the water table,
 * which a jar can't see; those stay from SSURGO.
 */
import type { Land } from '../algorithm/types';
import type { JarSoilPayload } from '../jar-test/jar_test';
import { mapTexture } from './ssurgo';

export interface JarSoil {
  /** Land fields to override (empty when the jar result can't be used). */
  land: Partial<Land>;
  /** For the provenance panel. */
  note: string | null;
  gaps: string[];
}

export function landFromJar(jar: JarSoilPayload, fieldName: string): JarSoil {
  const gaps: string[] = [];
  if (jar.sandPct === null || jar.clayPct === null) {
    const why = jar.siltClayCombined ? 'silt and clay settled as one layer' : 'no sand/clay split';
    gaps.push(`${fieldName}: jar test gave no texture (${why}); using the soil map.`);
    return { land: {}, note: null, gaps };
  }
  if (jar.confidence === 'low') {
    gaps.push(`${fieldName}: jar test confidence is low; using the soil map texture. Retake the photo after the jar settles to use it.`);
    return { land: {}, note: null, gaps };
  }
  const texture = mapTexture(jar.sandPct, jar.clayPct);
  const pct = `${Math.round(jar.sandPct)}% sand, ${Math.round(jar.siltPct ?? 100 - jar.sandPct - jar.clayPct)}% silt, ${Math.round(jar.clayPct)}% clay`;
  gaps.push(`${fieldName}: texture from the jar test (${pct}); available water capacity, drainage, pH and organic matter still come from the soil map.`);
  return {
    land: { texture },
    note: `jar test: ${jar.textureClass ?? texture} (${pct}; confidence ${jar.confidence}${jar.adjustedByFarmer ? ', layers adjusted by the farmer' : ''})`,
    gaps,
  };
}
