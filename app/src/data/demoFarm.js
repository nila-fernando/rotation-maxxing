// The pre-loaded demo farm as a search "place": for judges, curious visitors and anyone outside the
// US, and the safety net if live search fails during a demo. Its name and pin come from the demo
// farm data (data/demo-farm.json, bundled, so it works offline).
import { getFarm } from './farmData.js';

const farm = getFarm();

export const DEMO_FARM = {
  id: 'demo',
  kind: 'farm',
  label: farm.name,
  detail: `Demo farm · ${farm.county} County, ${farm.state}`,
  lat: farm.center[1],
  lon: farm.center[0],
  demo: true,
};
