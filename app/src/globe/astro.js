// Where the Sun, the Moon and the planets are, as seen from Earth, for the 3D globe.
// Low-precision astronomy with no dependencies: good to a fraction of a degree for 2020-2040,
// which is plenty for lighting the day side and placing bodies in the sky (not for navigation).
// Checked against JPL Horizons by `node tools/validation/validate-astro.mjs`.
//
// Globe frame (Earth-fixed, matches THREE.SphereGeometry with an equirectangular texture whose
// left edge is longitude -180):
//   x =  cos(lat) * cos(lon)
//   y =  sin(lat)              north pole = +Y
//   z = -cos(lat) * sin(lon)
// so lon 0, lat 0 is +X and lon 90E, lat 0 is -Z. A body's "direction" is the unit vector from
// Earth's centre to the point on Earth where that body is straight overhead (its sub-point).
//
// Methods:
//   Sun     Meeus, Astronomical Algorithms ch. 25 (low-precision solar coordinates).
//   Moon    Meeus ch. 47, truncated to the main periodic terms.
//   Planets JPL "Approximate Positions of the Planets", Table 1 (Keplerian elements and rates,
//           valid 1800-2050), https://ssd.jpl.nasa.gov/planets/approx_pos.html
//   GMST    IAU 1982 expression (Meeus eq. 12.4).
// Right ascension and declination are for the mean equator and equinox of the date, because that
// is the frame Greenwich mean sidereal time turns into Earth longitudes: lon = RA - GMST.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const AU_KM = 149597870.7;
const J2000 = 2451545.0;
/** Terrestrial Time minus UTC in seconds (32.184 + 37 leap seconds, unchanged since 2017). */
const TT_MINUS_UTC = 69.184;
/** Light travel time for one astronomical unit, in days. */
const LIGHT_DAYS_PER_AU = 0.0057755183;

const sin = (deg) => Math.sin(deg * RAD);
const cos = (deg) => Math.cos(deg * RAD);
const wrap360 = (deg) => ((deg % 360) + 360) % 360;
/** Wraps to (-180, 180]. */
const wrap180 = (deg) => {
  const w = wrap360(deg);
  return w > 180 ? w - 360 : w;
};

/** Julian day (UT) of a Date. */
const julianDay = (date) => date.getTime() / 86400000 + 2440587.5;
/** Julian centuries of Terrestrial Time since J2000.0. */
const centuriesTT = (date) => (julianDay(date) + TT_MINUS_UTC / 86400 - J2000) / 36525;
/** Mean obliquity of the ecliptic of the date, degrees. */
const obliquity = (T) => 23.4393 - 0.0130042 * T;

/** Unit vector in the globe frame for a latitude and longitude in degrees. */
export function latLonToVec3(lat, lon) {
  return [cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon)];
}

/** Latitude and longitude in degrees (lon in (-180, 180]) of a vector in the globe frame. */
export function vec3ToLatLon([x, y, z]) {
  const len = Math.hypot(x, y, z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / len))) * DEG;
  let lon = Math.atan2(-z, x) * DEG;
  if (lon <= -180) lon += 360;
  return { lat, lon: lon === 0 ? 0 : lon };
}

/** Greenwich mean sidereal time in degrees, 0..360. Longitude of a body = its RA - GMST. */
export function gmstDeg(date) {
  const d = julianDay(date) - J2000;
  const T = d / 36525;
  return wrap360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/** Ecliptic longitude/latitude of the date (degrees) to right ascension and declination. */
function eclipticToEquatorial(lambda, beta, T) {
  const eps = obliquity(T);
  const raDeg = wrap360(Math.atan2(sin(lambda) * cos(eps) - Math.tan(beta * RAD) * sin(eps), cos(lambda)) * DEG);
  const decDeg = Math.asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda)) * DEG;
  return { raDeg, decDeg };
}

/** Sub-point on Earth of a body at this right ascension and declination. */
const subPoint = (raDeg, decDeg, date) => ({ lat: decDeg, lon: wrap180(raDeg - gmstDeg(date)) });

/** Sun: ecliptic longitude of the date (with aberration), distance in au, RA and Dec. */
function sun(date) {
  const T = centuriesTT(date);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const distanceAu = (1.000001018 * (1 - e * e)) / (1 + e * cos(M + C));
  // -0.00569: aberration. Nutation is left out on purpose: it cancels against the same
  // term in sidereal time when the position is turned into an Earth longitude with GMST.
  const lambda = wrap360(L0 + C - 0.00569);
  return { lambda, distanceAu, ...eclipticToEquatorial(lambda, 0, T) };
}

/** Where on Earth the Sun is straight overhead at this instant. */
export function subsolarPoint(date) {
  const { raDeg, decDeg } = sun(date);
  return subPoint(raDeg, decDeg, date);
}

/** Unit vector from Earth's centre towards the Sun, in the globe frame. */
export function sunDirection(date) {
  const { lat, lon } = subsolarPoint(date);
  return latLonToVec3(lat, lon);
}

// Main periodic terms of the Moon (Meeus table 47.A). Arguments are multiples of D, M, M', F;
// longitude is in 1e-6 degrees (sine), distance in metres (cosine).
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
];

// Main periodic terms of the Moon's latitude (Meeus table 47.B), 1e-6 degrees (sine).
const MOON_B = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
];

/** Moon: ecliptic longitude/latitude of the date (degrees) and distance in km. */
function moon(date) {
  const T = centuriesTT(date);
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T;
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;
  // Terms that involve the Sun's anomaly M shrink with the Earth's orbital eccentricity.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const fade = (m) => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);

  let sumL = 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  let sumR = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    sumL += l * fade(m) * sin(arg);
    sumR += r * fade(m) * cos(arg);
  }
  let sumB = -2235 * sin(Lp) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  for (const [d, m, mp, f, b] of MOON_B) sumB += b * fade(m) * sin(d * D + m * M + mp * Mp + f * F);

  return { T, lambda: wrap360(Lp + sumL / 1e6), beta: sumB / 1e6, distanceKm: 385000.56 + sumR / 1000 };
}

/**
 * The Moon at this instant: `dir` is the globe-frame unit vector of the point on Earth below it,
 * `distanceKm` is centre to centre, `illuminated` is the lit fraction of its disc (0 new, 1 full).
 */
export function moonPosition(date) {
  const { T, lambda, beta, distanceKm } = moon(date);
  const { raDeg, decDeg } = eclipticToEquatorial(lambda, beta, T);
  const { lat, lon } = subPoint(raDeg, decDeg, date);

  const s = sun(date);
  const sunKm = s.distanceAu * AU_KM;
  // Elongation from the Sun, then the Sun-Moon-Earth phase angle (Meeus ch. 48).
  const cosElong = cos(beta) * cos(lambda - s.lambda);
  const sinElong = Math.sqrt(Math.max(0, 1 - cosElong * cosElong));
  const phase = Math.atan2(sunKm * sinElong, distanceKm - sunKm * cosElong);

  return { dir: latLonToVec3(lat, lon), distanceKm, illuminated: (1 + Math.cos(phase)) / 2 };
}

// JPL "Approximate Positions of the Planets", Table 1: Keplerian elements at J2000 and their
// rates per Julian century, mean ecliptic and equinox of J2000, valid 1800 AD - 2050 AD.
// Copied from https://ssd.jpl.nasa.gov/planets/approx_pos.html
// Columns: a (au), e, I (deg), L mean longitude (deg), long. of perihelion (deg), long. of node (deg).
const ELEMENTS = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  // Earth-Moon barycentre: used as the Earth (the Earth is at most 4,700 km from it).
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
};

const PLANETS = [
  { id: 'mercury', name: 'Mercury' },
  { id: 'venus', name: 'Venus' },
  { id: 'mars', name: 'Mars' },
  { id: 'jupiter', name: 'Jupiter' },
  { id: 'saturn', name: 'Saturn' },
  { id: 'uranus', name: 'Uranus' },
  { id: 'neptune', name: 'Neptune' },
];

/** Heliocentric position in au, J2000 ecliptic frame, T centuries (TT) after J2000 (JPL's recipe). */
function heliocentric(id, T) {
  const [at0, rate] = ELEMENTS[id];
  const [a, e, I, L, peri, node] = at0.map((v, i) => v + rate[i] * T);
  const w = peri - node;
  const M = wrap180(L - peri);
  // Kepler's equation M = E - e* sin E, in degrees (e* = e in degrees).
  const eStar = e * DEG;
  let E = M + eStar * sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (E - eStar * sin(E))) / (1 - e * cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  const xp = a * (cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * sin(E);
  return [
    (cos(w) * cos(node) - sin(w) * sin(node) * cos(I)) * xp + (-sin(w) * cos(node) - cos(w) * sin(node) * cos(I)) * yp,
    (cos(w) * sin(node) + sin(w) * cos(node) * cos(I)) * xp + (-sin(w) * sin(node) + cos(w) * cos(node) * cos(I)) * yp,
    sin(w) * sin(I) * xp + cos(w) * sin(I) * yp,
  ];
}

/**
 * The seven other planets as seen from Earth's centre at this instant. `dir` is the globe-frame
 * unit vector of the point on Earth below the planet, `distanceAu` the Earth-planet distance,
 * `raDeg`/`decDeg` the right ascension and declination for the equator and equinox of the date.
 */
export function planetPositions(date) {
  const T = centuriesTT(date);
  const earth = heliocentric('earth', T);
  // General precession in longitude since J2000: turns J2000 ecliptic longitudes into longitudes
  // of the date, so they pair with the obliquity of the date and with sidereal time.
  const precession = 1.3969713 * T + 0.0003086 * T * T;
  return PLANETS.map(({ id, name }) => {
    // Where the planet was when the light we see now left it (one pass is enough).
    let geo = heliocentric(id, T).map((v, i) => v - earth[i]);
    const lightDays = Math.hypot(...geo) * LIGHT_DAYS_PER_AU;
    geo = heliocentric(id, T - lightDays / 36525).map((v, i) => v - earth[i]);
    const distanceAu = Math.hypot(...geo);
    const lambda = Math.atan2(geo[1], geo[0]) * DEG + precession;
    const beta = Math.asin(geo[2] / distanceAu) * DEG;
    const { raDeg, decDeg } = eclipticToEquatorial(lambda, beta, T);
    const { lat, lon } = subPoint(raDeg, decDeg, date);
    return { id, name, dir: latLonToVec3(lat, lon), distanceAu, raDeg, decDeg };
  });
}
