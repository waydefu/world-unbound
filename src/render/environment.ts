import { type DataTexture, Color, DirectionalLight, FogExp2, HemisphereLight, type Scene } from 'three/webgpu';
import type { SlidingRate } from '../perf/slidingRate';
import type { Weather } from '../env/weather';
import type { CelestialState } from '../env/ephemeris';
import type { SkySummary } from '../env/skyView';
import { SV_H, SV_W } from '../env/skyView';
import { Ocean } from './ocean';
import { SkyDome } from './sky';

/**
 * Lighting driven by the physical atmosphere (ADR-0002, specification §4.2).
 *
 * Units: the sky tables give radiance for a solar illuminance of 1. The scene
 * uses a sun illuminance of pi, so a white Lambert surface under a zenith sun
 * has radiance 1 and exposure stays near 1 at midday. Sky radiance, fog
 * colour and sky irradiance are scaled by the same pi.
 */
const WEATHER: Record<Weather, { sun: number; overcast: number; fog: number; dim: number }> = {
  clear: { sun: 1, overcast: 0, fog: 0.00022, dim: 1 },
  cloudy: { sun: 0.4, overcast: 0.55, fog: 0.00035, dim: 0.75 },
  rain: { sun: 0.12, overcast: 1, fog: 0.0008, dim: 0.45 },
  storm: { sun: 0.05, overcast: 1, fog: 0.0013, dim: 0.3 },
};

/** Full-moon illuminance relative to the sun (about 0.25 lux against 100 klux). */
const MOON_ILLUMINANCE = 2.5e-6;
/** Moonlight and night ambience lean blue (Purkinje shift of dark-adapted vision). */
const MOON_TINT = new Color(0.62, 0.74, 1);
const TINT = [MOON_TINT.r, MOON_TINT.g, MOON_TINT.b];
/** Starlight and airglow floor so moonless nights are dark but not black (radiance units). */
const NIGHT_FLOOR = 3e-7;
/** Share of the overcast zenith radiance added to the ambient light under full cloud. */
const OVERCAST_LIFT = 1.2;
const MIN_EXPOSURE = 0.4;
/** Upper bound of adaptation: scotopic vision reaches roughly 1e-6 of daylight. */
const MAX_EXPOSURE = 1e6;

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const luminance = (c: ArrayLike<number>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export class Environment {
  readonly sun = new DirectionalLight(0xffffff, 1);
  readonly moon = new DirectionalLight(0xffffff, 0);
  readonly ambient = new HemisphereLight(0xffffff, 0x3a3428, 1);
  readonly sky = new SkyDome();
  readonly ocean: Ocean;
  private readonly fog = new FogExp2(0x000000, 0.0002);
  sunAltitudeDeg = 0;
  /** Receives the bytes of every sky-table upload (set by the app). */
  uploads: SlidingRate | null = null;
  /** Exposure that would map this lighting to mid-grey; the app adapts towards it. */
  targetExposure = 1;
  private sunBase = 0;
  private moonBase = 0;
  private readonly fogBase = new Color();
  private readonly overcastZenith = new Float64Array(3);

  constructor(scene: Scene, noise: DataTexture, lite = false) {
    this.ocean = new Ocean(this.sky, noise, lite);
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.ambient, this.ocean.mesh, this.sky.mesh);
    scene.fog = this.fog;
    scene.background = null;
  }

  /** Applies a freshly published sky table. Low frequency: on camera cuts and as the sun moves. */
  apply(table: Float32Array, summary: SkySummary, celestial: CelestialState, weather: Weather): void {
    const w = WEATHER[weather];
    const sinAlt = Math.sin(celestial.sunAltitude);
    this.sunAltitudeDeg = (celestial.sunAltitude * 180) / Math.PI;
    const sunVisible = smooth(-0.02, 0.01, sinAlt);
    const t = summary.sunTransmittance;

    // Direct sun.
    this.sun.position.set(celestial.sun[0] * 1000, celestial.sun[1] * 1000, celestial.sun[2] * 1000);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setRGB(t[0], t[1], t[2]);
    this.sunBase = Math.PI * w.sun * sunVisible;

    // Moon, dimmed by phase, cloud and its own altitude.
    const moonUp = smooth(-0.02, 0.1, Math.sin(celestial.moonAltitude));
    const moonIllum = MOON_ILLUMINANCE * celestial.moonIllumination * moonUp * (1 - 0.8 * w.overcast);
    this.moon.position.set(celestial.moon[0] * 1000, celestial.moon[1] * 1000, celestial.moon[2] * 1000);
    this.moon.target.position.set(0, 0, 0);
    this.moon.color.copy(MOON_TINT);
    this.moonBase = Math.PI * moonIllum;

    // Sky ambience: irradiance from the sky table, greyed and dimmed by cloud.
    const e = summary.skyIrradianceUp;
    const eLum = luminance(e);
    const overcastMix = (c: number): number => (e[c] + (eLum - e[c]) * w.overcast) * w.dim;
    const night = NIGHT_FLOOR * Math.PI;
    // Under cloud the ground is lit by the whole deck: lift the floor by a share of the overcast zenith (not
    // only by the starlight floor) so terrain stays readable against the brighter sky. Exposure does not see it.
    const lift = (c: number): number => OVERCAST_LIFT * w.overcast * (9 / 7) * (eLum * w.dim + NIGHT_FLOOR * TINT[c]);
    this.ambient.color.setRGB(
      Math.PI * (overcastMix(0) + lift(0)) + night * MOON_TINT.r,
      Math.PI * (overcastMix(1) + lift(1)) + night * MOON_TINT.g,
      Math.PI * (overcastMix(2) + lift(2)) + night * MOON_TINT.b,
    );
    // Ground bounce: 0.35 x sky plus 10% of the sun's irradiance scattered by average (0.25) ground albedo.
    const bounce = 0.1 * 0.25 * this.sunBase;
    this.ambient.groundColor.setRGB(
      0.35 * this.ambient.color.r + bounce * t[0],
      0.35 * this.ambient.color.g + bounce * t[1],
      0.35 * this.ambient.color.b + bounce * t[2],
    );

    // Cloud deck: CIE standard overcast sky with the same irradiance, E = 7 pi Lz / 9,
    // so the overcast sky and the ambient light it casts always agree.
    const zenith = this.overcastZenith;
    for (let c = 0; c < 3; c++) zenith[c] = (9 / 7) * (eLum * w.dim + NIGHT_FLOOR * TINT[c]);

    // Aerial perspective approximated by exponential fog tinted with the horizon radiance.
    const h = summary.horizon;
    const fog = (c: number): number => Math.PI * h[c] + ((zenith[c] / 3) - Math.PI * h[c]) * w.overcast + night * 0.3;
    this.fogBase.setRGB(fog(0), fog(1), fog(2));
    this.fog.density = w.fog;

    const moonDisc = Math.PI * MOON_ILLUMINANCE * celestial.moonIllumination * (1 / 6.4e-5) * (1 - 0.9 * w.overcast);
    this.ocean.setWeather(weather);
    // Zenith radiance as the dome shows it: the table's top row (azimuth-averaged), mixed with the overcast deck.
    let top0 = 0;
    let top1 = 0;
    let top2 = 0;
    const row = (SV_H - 1) * SV_W * 4;
    for (let i = 0; i < SV_W; i++) {
      top0 += table[row + i * 4];
      top1 += table[row + i * 4 + 1];
      top2 += table[row + i * 4 + 2];
    }
    const k = Math.PI / SV_W;
    this.ocean.setZenith(
      top0 * k + (zenith[0] - top0 * k) * w.overcast,
      top1 * k + (zenith[1] - top1 * k) * w.overcast,
      top2 * k + (zenith[2] - top2 * k) * w.overcast,
    );
    this.sky.setTable(table);
    this.uploads?.add(performance.now(), this.sky.tableBytes);
    this.sky.setCelestial(celestial.sun, celestial.moon, t, moonDisc, 4e-6 * (1 - sunVisible) * (1 - w.overcast),
      w.overcast, sunVisible * (1 - w.overcast), zenith);

    // White-surface radiance (sun on a horizontal surface + sky + moon + floor) sets exposure;
    // nights keep a lower key so they read as night (dark adaptation), not as dim day. Under cloud there
    // is no direct sun, so the key ramp starts at the horizon instead of in twilight: a white surface lit
    // only by sky ambient maps to ~0.12 until the sun is up, which keeps overcast dusk/night from
    // showing a sky far brighter than the ground.
    const white = luminance(t) * Math.max(0, sinAlt) * w.sun * sunVisible + eLum * w.dim
      + moonIllum * Math.max(0, Math.sin(celestial.moonAltitude)) + NIGHT_FLOOR;
    const key = 0.12 + 0.88 * smooth(-0.1 + 0.1 * w.overcast, 0.06 + 0.1 * w.overcast, sinAlt);
    this.targetExposure = Math.min(MAX_EXPOSURE, Math.max(MIN_EXPOSURE, key / white));
  }

  /**
   * Pre-exposure (Frostbite): exposure is folded into every light and the sky
   * before shading, so night radiance (1e-6 of daylight) does not land in
   * half-float subnormals and band. The renderer's own exposure stays 1.
   * @hot uniform and light writes only
   */
  setExposure(exposure: number): void {
    this.sun.intensity = this.sunBase * exposure;
    this.moon.intensity = this.moonBase * exposure;
    this.ambient.intensity = exposure;
    this.fog.color.copy(this.fogBase).multiplyScalar(exposure);
    this.sky.setExposure(exposure);
    this.ocean.setExposure(exposure);
  }
}
