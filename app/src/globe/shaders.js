// GLSL for the globe scene. World space is the Earth-fixed frame of astro.js:
// +Y is the north pole, longitude 0 is +X and 90°E is -Z, so the Earth mesh never rotates
// and the Sun, Moon, planets and stars move around it instead.

const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(11.7, 5.3, 2.9);
    a *= 0.5;
  }
  return s;
}
`;

// ---------------------------------------------------------------- Earth
export const earthVertex = /* glsl */ `
uniform sampler2D uPack; // r = height, g = roughness, b = clouds
uniform float uRelief;
varying vec2 vUv;
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vDir = normalize(position);
  // a blurred mip, so the mesh follows the mountain ranges instead of single pixels
  float h = textureLod(uPack, uv, 3.0).r;
  vec4 wp = modelMatrix * vec4(vDir * (1.0 + h * uRelief), 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const earthFragment = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uPack;
uniform sampler2D uPatch;
uniform vec3 uSunDir;
uniform vec2 uTexel;
uniform float uReliefShade;
uniform float uDive;        // 0 = seen from orbit, 1 = flat daylight imagery, as on the map
uniform float uCloudShift;
uniform float uCloudAmount;
uniform float uPatchOpacity;
uniform vec4 uPatchRect;    // web-mercator rectangle of the tile patch: west x, north y, width, height (0..1)
uniform float uToon;        // 1 = the cozy cartoon look of the island, 0 = realistic
varying vec2 vUv;
varying vec3 vDir;
varying vec3 vWorldPos;

const float PI = 3.141592653589793;

vec3 saturation(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}
// light in a few flat steps with soft edges, like cel shading
float bands(float x) {
  float s = 0.0;
  s += 0.42 * smoothstep(-0.02, 0.06, x);
  s += 0.34 * smoothstep(0.22, 0.30, x);
  s += 0.24 * smoothstep(0.55, 0.63, x);
  return s;
}
// the real picture recoloured into the island's palette: lavender seas, sage and butter land, soft sand, white ice
vec3 toonAlbedo(vec3 albedo, float water, vec2 uv) {
  float l = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  // sea: deep where the bathymetry is dark, shallow and minty-lilac near coasts
  vec3 deep = vec3(0.56, 0.53, 0.87), mid = vec3(0.67, 0.65, 0.93), shal = vec3(0.83, 0.81, 0.98);
  float d = smoothstep(0.05, 0.30, l);
  vec3 sea = mix(deep, mid, smoothstep(0.0, 0.5, d));
  sea = mix(sea, shal, smoothstep(0.55, 0.95, d));
  // land: how green or dry the real ground is decides sage, olive, butter or sand, in flat steps
  float green = albedo.g - 0.5 * (albedo.r + albedo.b);
  float dry = albedo.r - albedo.b;
  vec3 forest = vec3(0.45, 0.60, 0.27), meadow = vec3(0.66, 0.74, 0.35), butter = vec3(0.85, 0.79, 0.46), sand = vec3(0.90, 0.78, 0.55);
  float g = smoothstep(0.0, 0.035, green);
  vec3 land = mix(mix(sand, butter, smoothstep(0.30, 0.15, dry)), mix(meadow, forest, smoothstep(0.30, 0.18, l)), g);
  land = mix(land, vec3(0.97, 0.96, 1.0), smoothstep(0.62, 0.80, l));     // snow and ice
  // posterise the brightness a little so the land reads as painted patches
  float poster = floor(l * 5.0 + 0.5) / 5.0;
  land *= 0.86 + 0.28 * poster;
  return pow(mix(land, sea, water), vec3(2.2));
}

void main() {
  vec3 N0 = normalize(vDir);
  vec3 east = normalize(vec3(N0.z, 0.0, -N0.x) + vec3(0.0, 0.0, 1e-6));
  vec3 north = cross(N0, east);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 pack = texture2D(uPack, vUv).rgb;
  float cosLat = max(0.2, length(N0.xz));

  // relief: tilt the normal by the slope of the height map
  float hE = texture2D(uPack, vUv + vec2(uTexel.x, 0.0)).r;
  float hW = texture2D(uPack, vUv - vec2(uTexel.x, 0.0)).r;
  float hN = texture2D(uPack, vUv + vec2(0.0, uTexel.y)).r;
  float hS = texture2D(uPack, vUv - vec2(0.0, uTexel.y)).r;
  vec3 N = normalize(N0 - uReliefShade * ((hE - hW) / cosLat * east + (hN - hS) * north));

  float sun0 = dot(N0, uSunDir);
  float sunR = dot(N, uSunDir);
  float day = smoothstep(-0.10, 0.22, sun0);

  // ---- day side
  vec3 albedo = texture2D(uDay, vUv).rgb;
  float waterMask = 1.0 - smoothstep(0.08, 0.35, pack.g);
  vec3 graded = mix(saturation(albedo, 1.28) * 1.12, toonAlbedo(albedo, waterMask, vUv), uToon);
  float light = max(sunR, 0.0) * 0.86 + max(sun0, 0.0) * 0.34;
  // cartoon: flat lighting steps, with a lavender shade instead of black
  float toonLight = bands(mix(sun0, sunR, 0.35));
  vec3 lit = mix(graded * (0.05 + 1.25 * light), graded * mix(vec3(0.20, 0.18, 0.44), vec3(1.05), toonLight), uToon);

  // clouds throw a soft shadow, offset towards the Sun
  vec2 toSun = vec2(dot(uSunDir, east) / cosLat / (2.0 * PI), dot(uSunDir, north) / PI) * 0.016;
  float shadow = texture2D(uPack, vUv + vec2(uCloudShift, 0.0) + toSun).b;
  lit *= 1.0 - mix(0.5 * smoothstep(0.15, 0.8, shadow), 0.22 * step(0.5, shadow), uToon) * uCloudAmount;

  // sun glint on water
  vec3 H = normalize(V + uSunDir);
  float water = 1.0 - smoothstep(0.08, 0.35, pack.g);
  float glint = pow(max(dot(N0, H), 0.0), 70.0) * 0.7 + pow(max(dot(N0, H), 0.0), 9.0) * 0.07;
  lit += vec3(1.0, 0.9, 0.74) * mix(glint, step(0.93, pow(max(dot(N0, H), 0.0), 40.0)) * 0.55, uToon) * water * day;
  // cartoon coastlines: a soft white foam line where land meets sea, like the island's shore
  float wE = 1.0 - smoothstep(0.08, 0.35, texture2D(uPack, vUv + vec2(uTexel.x * 1.6, 0.0)).g);
  float wN = 1.0 - smoothstep(0.08, 0.35, texture2D(uPack, vUv + vec2(0.0, uTexel.y * 1.6)).g);
  float coast = clamp((abs(wE - water) + abs(wN - water)) * 1.6, 0.0, 1.0) * water;
  lit = mix(lit, vec3(1.0, 0.97, 1.0) * (0.25 + 0.75 * toonLight), coast * 0.85 * uToon);

  // warm band at sunrise and sunset
  float twilight = smoothstep(-0.14, 0.04, sun0) * (1.0 - smoothstep(0.04, 0.34, sun0));
  lit *= mix(vec3(1.0), vec3(1.32, 0.80, 0.56), twilight * 0.7);

  // ---- night side: faint moonlit land, and city lights
  vec3 nightTex = texture2D(uNight, vUv).rgb;
  float lights = smoothstep(0.02, 0.32, nightTex.r - 0.4 * nightTex.b);
  float overhead = texture2D(uPack, vUv + vec2(uCloudShift, 0.0)).b * uCloudAmount;
  vec3 night = nightTex * vec3(0.5, 0.6, 0.95) * 0.55 + graded * vec3(0.012, 0.016, 0.03);
  night += vec3(1.0, 0.74, 0.42) * lights * 1.9 * (1.0 - 0.65 * smoothstep(0.2, 0.8, overhead));
  // cartoon night: a moonlit indigo version of the day colours, with warm dotted town lights
  vec3 toonNight = graded * vec3(0.10, 0.11, 0.26) + vec3(0.006, 0.006, 0.024);
  toonNight += vec3(1.0, 0.66, 0.24) * step(0.42, lights) * 0.9 * (1.0 - 0.7 * step(0.5, overhead));
  night = mix(night, toonNight, uToon);

  float dayT = mix(day, smoothstep(-0.05, 0.08, sun0), uToon);   // a crisper day-night line
  vec3 col = mix(night, lit, dayT);
  col = mix(col, col * vec3(1.25, 0.82, 0.78) + vec3(0.03, 0.006, 0.012), uToon * smoothstep(-0.05, 0.0, sun0) * (1.0 - smoothstep(0.0, 0.07, sun0)) * 0.55);

  // air: blue haze towards the limb, brighter in daylight
  float fres = pow(1.0 - max(dot(N0, V), 0.0), 3.2);
  col += mix(vec3(0.20, 0.46, 1.0) * fres * (0.10 + 0.9 * day) * 0.7,
             vec3(0.34, 0.30, 0.90) * smoothstep(0.45, 0.8, fres) * (0.2 + 0.6 * dayT) * 0.35, uToon) * (1.0 - uDive);
  // cartoon outline around the planet's edge
  float rim = 1.0 - smoothstep(0.06, 0.16, max(dot(N0, V), 0.0));
  col = mix(col, vec3(0.20, 0.17, 0.36), rim * 0.85 * uToon * (1.0 - uDive));

  // ---- close to the ground the globe turns into the map: flat daylight imagery
  vec3 flatCol = albedo;
  if (uPatchOpacity > 0.0) {
    float lat = (vUv.y - 0.5) * PI;
    float my = 0.5 - log(tan(0.25 * PI + 0.5 * clamp(lat, -1.48, 1.48))) / (2.0 * PI);
    vec2 p = vec2(fract(vUv.x - uPatchRect.x), my - uPatchRect.y) / uPatchRect.zw;
    if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
      vec4 tile = texture2D(uPatch, vec2(p.x, 1.0 - p.y));
      vec2 edge = smoothstep(vec2(0.0), vec2(0.1), p) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - p);
      float a = tile.a * edge.x * edge.y * uPatchOpacity;
      flatCol = mix(flatCol, tile.rgb, a);
      col = mix(col, mix(col, tile.rgb * (0.05 + 1.25 * light) , day), a * (1.0 - uDive));
    }
  }
  col = mix(col, flatCol, uDive);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Clouds
export const cloudVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const cloudFragment = /* glsl */ `
uniform sampler2D uPack;
uniform vec3 uSunDir;
uniform float uCloudShift;
uniform float uCloudAmount;
uniform float uToon;
varying vec2 vUv;
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vDir);
  float c = texture2D(uPack, vUv + vec2(uCloudShift, 0.0)).b;
  // cartoon: only the thick clouds, with a hard puffy edge
  float alpha = mix(smoothstep(0.10, 0.78, c), smoothstep(0.42, 0.50, c), uToon) * uCloudAmount;
  if (alpha < 0.004) discard;
  float sun = dot(N, uSunDir);
  float day = smoothstep(-0.16, 0.28, sun);
  float twilight = smoothstep(-0.2, 0.02, sun) * (1.0 - smoothstep(0.02, 0.36, sun));
  vec3 col = mix(vec3(0.016, 0.022, 0.045), vec3(1.0) * (0.55 + 0.55 * max(sun, 0.0)), day);
  col *= mix(vec3(1.0), vec3(1.35, 0.78, 0.55), twilight * 0.75);
  // cartoon clouds: flat white with a lilac underside step, and lavender at night
  float puff = smoothstep(0.55, 0.72, c);
  vec3 toonCol = mix(vec3(0.66, 0.62, 0.92), vec3(1.0), puff) * mix(0.35, 1.0, smoothstep(-0.02, 0.10, sun));
  toonCol = mix(vec3(0.05, 0.05, 0.16), toonCol, smoothstep(-0.12, 0.04, sun));
  col = mix(col, toonCol, uToon);
  vec3 V = normalize(cameraPosition - vWorldPos);
  alpha *= mix(0.35 + 0.65 * smoothstep(0.0, 0.35, dot(N, V)), 0.6 + 0.4 * smoothstep(0.0, 0.2, dot(N, V)), uToon); // thin out at the limb
  gl_FragColor = vec4(col, alpha * mix(0.92, 0.95, uToon));
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Atmosphere (halo outside the limb)
export const airVertex = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const airFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform float uStrength;
uniform float uToon;
varying vec3 vWorldPos;
void main() {
  vec3 ray = normalize(vWorldPos - cameraPosition);
  float t = -dot(cameraPosition, ray);
  vec3 closest = cameraPosition + ray * max(t, 0.0);
  float b = length(closest);               // how near this line of sight passes to the Earth's centre
  float height = max(b - 1.0, 0.0);
  float glow = exp(-height / 0.022) * 0.9 + exp(-height / 0.075) * 0.22;
  glow *= step(1.0, b) * step(0.0, t);
  vec3 P = normalize(closest);
  float sun = dot(P, uSunDir);
  float day = smoothstep(-0.28, 0.3, sun);
  float twilight = smoothstep(-0.32, -0.02, sun) * (1.0 - smoothstep(-0.02, 0.4, sun));
  float forward = pow(max(dot(ray, uSunDir), 0.0), 6.0);  // looking towards the Sun through the air
  vec3 col = mix(mix(vec3(0.24, 0.52, 1.0), vec3(0.66, 0.60, 1.0), uToon), mix(vec3(1.0, 0.5, 0.24), vec3(1.0, 0.62, 0.66), uToon), twilight * 0.72);
  glow = mix(glow, (1.0 - smoothstep(0.0, 0.045, height)) * 0.55 * step(1.0, b) * step(0.0, t) + glow * 0.25, uToon); // a soft, even halo band
  col = mix(col, vec3(1.0, 0.72, 0.45), forward * 0.6);
  float amount = glow * (0.04 + day * 0.96 + forward * 0.9 * smoothstep(-0.45, 0.0, sun)) * uStrength;
  gl_FragColor = vec4(col * amount, amount);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Stars
export const starVertex = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uPixelRatio;
uniform float uTime;
uniform float uTwinkle;
varying vec3 vColor;
varying float vGlow;
void main() {
  float tw = 1.0 + uTwinkle * 0.22 * sin(uTime * (0.6 + aPhase * 1.7) + aPhase * 40.0);
  vColor = aColor * tw;
  vGlow = aSize;
  gl_PointSize = max(1.0, aSize * uPixelRatio * tw);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  float a = pow(core, mix(1.2, 2.6, clamp(vGlow / 4.0, 0.0, 1.0)));
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Milky Way (drawn once into a texture)
export const skyBakeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const skyBakeFragment = /* glsl */ `
uniform vec3 uGalNorth;
uniform vec3 uGalCentre;
varying vec2 vUv;
${NOISE}
void main() {
  float lon = (vUv.x - 0.5) * 6.283185307;
  float lat = (vUv.y - 0.5) * 3.141592653;
  vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
  float b = asin(clamp(dot(dir, uGalNorth), -1.0, 1.0));
  float towards = dot(dir, uGalCentre) * 0.5 + 0.5;
  float width = mix(0.11, 0.24, towards * towards);
  float band = exp(-(b * b) / (width * width));
  float clouds = fbm(dir * 5.0);
  float lanes = smoothstep(0.38, 0.62, fbm(dir * 9.0 + 7.0)) * exp(-(b * b) / 0.012);
  float dust = fbm(dir * 22.0);
  float glow = band * (0.35 + 0.9 * clouds) * (0.55 + 0.75 * towards) * (1.0 - 0.7 * lanes) * (0.75 + 0.5 * dust);
  vec3 cool = vec3(0.42, 0.55, 0.95);
  vec3 warm = vec3(1.0, 0.80, 0.58);
  vec3 col = mix(cool, warm, towards * towards) * glow * 0.20;
  // two faint nebulas for colour
  col += vec3(0.75, 0.22, 0.42) * pow(max(dot(dir, normalize(vec3(-0.35, 0.25, 0.9))), 0.0), 60.0) * fbm(dir * 12.0) * 0.20;
  col += vec3(0.16, 0.42, 0.62) * pow(max(dot(dir, normalize(vec3(0.6, -0.5, -0.62))), 0.0), 40.0) * fbm(dir * 10.0 + 3.0) * 0.16;
  col += vec3(0.004, 0.005, 0.011);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const skyVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragment = /* glsl */ `
uniform sampler2D uSky;
uniform float uGain;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uSky, vUv).rgb * uGain, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Sun (a glow on a camera-facing card)
export const cardVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunFragment = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float disc = smoothstep(0.052, 0.040, r);
  float corona = exp(-r * 16.0) * 1.5 + exp(-r * 5.5) * 0.42 + exp(-r * 2.4) * 0.10;
  float rays = (0.5 + 0.5 * sin(ang * 6.0 + 0.7)) * (0.5 + 0.5 * sin(ang * 13.0 - uTime * 0.05)) * exp(-r * 4.2) * 0.30;
  float fade = smoothstep(1.0, 0.55, r);
  vec3 col = vec3(1.0, 0.96, 0.88) * disc * 3.0 + vec3(1.0, 0.82, 0.55) * (corona + rays);
  float a = clamp(disc + corona + rays, 0.0, 1.0) * fade;
  gl_FragColor = vec4(col * fade, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Comet
export const cometFragment = /* glsl */ `
varying vec2 vUv;
void main() {
  // head near the left end, tail streaming to +x
  vec2 p = vec2(vUv.x, (vUv.y - 0.5) * 2.0);
  float head = exp(-length(vec2((p.x - 0.08) * 6.0, p.y * 1.6)) * 9.0);
  float along = clamp((p.x - 0.08) / 0.92, 0.0, 1.0);
  float width = mix(0.05, 0.55, along);
  float tail = exp(-(p.y * p.y) / (width * width)) * pow(1.0 - along, 1.8) * step(0.08, p.x) * 0.55;
  vec3 col = vec3(0.86, 0.95, 1.0) * head * 2.2 + vec3(0.45, 0.72, 1.0) * tail;
  float a = clamp(head + tail, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Moon and planets
export const bodyVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const moonFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLightDir;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vec3 N = normalize(vNormalW);
  float l = max(dot(N, uLightDir), 0.0);
  vec3 tex = texture2D(uMap, vUv).rgb;
  vec3 col = tex * (0.022 + 1.25 * pow(l, 0.8));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** kind: 0 rocky, 1 banded gas giant, 2 smooth ice giant, 3 cloud-covered */
export const planetFragment = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uKind;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${NOISE}
void main() {
  vec3 N = normalize(vNormalW);
  vec3 p = vObj + uSeed;
  float lat = asin(clamp(vObj.y, -1.0, 1.0));
  vec3 col;
  if (uKind < 0.5) {
    float n = fbm(p * 3.2);
    float craters = fbm(p * 11.0);
    col = mix(uColorA, uColorB, smoothstep(0.35, 0.65, n));
    col *= 0.82 + 0.36 * craters;
    col = mix(col, uColorC, smoothstep(1.18, 1.36, abs(lat)));         // polar caps
  } else if (uKind < 1.5) {
    float turb = fbm(vec3(p.x * 2.0, p.y * 9.0, p.z * 2.0)) - 0.5;
    float bands = sin(lat * 15.0 + turb * 3.2);
    col = mix(uColorA, uColorB, smoothstep(-0.55, 0.55, bands));
    col = mix(col, uColorC, smoothstep(0.55, 0.95, sin(lat * 7.0 + 1.3 + turb * 2.0)) * 0.55);
    float spot = smoothstep(0.16, 0.05, length(vec2((atan(vObj.z, vObj.x) - 0.9) * 0.55, lat + 0.38)));
    col = mix(col, uColorC * vec3(1.15, 0.62, 0.48), spot * 0.75);
  } else if (uKind < 2.5) {
    float bands = sin(lat * 6.0 + fbm(p * 2.0) * 1.5);
    col = mix(uColorA, uColorB, 0.5 + 0.35 * bands);
  } else {
    float swirl = fbm(vec3(p.x * 2.4, p.y * 5.5, p.z * 2.4) + fbm(p * 4.0));
    col = mix(uColorA, uColorB, smoothstep(0.3, 0.7, swirl));
  }
  float l = max(dot(N, uLightDir), 0.0);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float limb = pow(max(dot(N, V), 0.0), 0.45);
  gl_FragColor = vec4(col * (0.03 + 1.2 * l) * (0.55 + 0.45 * limb), 1.0);
  #include <colorspace_fragment>
}
`;

export const ringVertex = /* glsl */ `
varying float vRadius;
void main() {
  vRadius = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ringFragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uInner;
uniform float uOuter;
uniform float uLight;
varying float vRadius;
void main() {
  float r = (vRadius - uInner) / (uOuter - uInner);
  if (r < 0.0 || r > 1.0) discard;
  float bands = 0.55 + 0.45 * sin(r * 46.0) * sin(r * 17.0 + 1.0);
  float gap = smoothstep(0.035, 0.0, abs(r - 0.62));                   // Cassini division
  float a = smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.92, r) * (0.35 + 0.6 * bands) * (1.0 - 0.9 * gap);
  gl_FragColor = vec4(mix(uColorA, uColorB, bands) * uLight, a * 0.9);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- Ground pin (a pulsing ring on the surface)
export const pinFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float pulse = fract(uTime * 0.6);
  float ring = smoothstep(0.08, 0.0, abs(r - pulse)) * (1.0 - pulse);
  float dot_ = smoothstep(0.2, 0.14, r);
  float halo = smoothstep(0.34, 0.2, r) * 0.35;
  float a = clamp(ring + dot_ + halo, 0.0, 1.0);
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
