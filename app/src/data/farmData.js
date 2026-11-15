// Demo farm data, read by the rest of the app. Everything comes from /data/demo-farm.json, which is
// imported statically so Vite bundles it into the JS: the demo works with the network turned off.
//
// Real: field outlines, acres and 2018-2025 crop history (USDA NASS Crop Sequence Boundaries,
// Story County, Iowa) and the farm centre (the demo pin). Placeholder: farm and field names, soil,
// slope, elevation, NDVI, weather, county yields, prices and costs. Placeholders are realistic for
// Story County and get replaced by real data (SSURGO, SRTM, Sentinel-2, NASA POWER, NASS, ERS)
// later; demo.meta lists exactly which is which, plus sources, units and the crop key mapping.
//
// The data is frozen once at load, so getters hand out the same objects and callers can't mutate them.
import demo from '../../data/demo-farm.json' with { type: 'json' };

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const DATA = deepFreeze(demo);
const BY_ID = new Map(DATA.fields.map((f) => [f.id, f]));
const BY_SOURCE_ID = new Map(DATA.fields.map((f) => [f.sourceId, f]));

/** Which values are real vs placeholder, sources, units and crop key mapping. */
export const getMeta = () => DATA.meta;

/** { name, county, state, center: [lon, lat] } */
export const getFarm = () => DATA.farm;

/** All fields, in order f1..f5. */
export const getFields = () => DATA.fields;

/** One field by id ('f1'...), or null. */
export const getField = (id) => BY_ID.get(id) ?? null;

/** The field whose USDA CSB outline id (e.g. 'usda-191825001177203') matches, or null. */
export const findFieldBySourceId = (sourceId) => BY_SOURCE_ID.get(sourceId) ?? null;

/** { growingSeasonRainMm: [{ year, value }], avg30yrRainMm } */
export const getWeather = () => DATA.weather;

/** { yields: { crop: [{ year, buPerAcre }] }, prices, costsPerAcre } */
export const getCounty = () => DATA.county;
