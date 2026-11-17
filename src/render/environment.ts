import {
  Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Scene,
} from 'three/webgpu';
import type { Weather } from '../app/params';

/**
 * Engine-milestone lighting: an analytic sun for latitude 53.9 N, a flat sea
 * plane and distance fog. The 32-day calendar, sky LUT, shadows and the
 * multi-band ocean replace this in the atmosphere/ocean milestone.
 */
const LATITUDE = (53.9 * Math.PI) / 180;
/** Fixed late-spring declination until the calendar exists. */
const DECLINATION = (12 * Math.PI) / 180;

const WEATHER: Record<Weather, { sun: number; sky: number; fogFar: number; grey: number }> = {
  clear: { sun: 1, sky: 1, fogFar: 5200, grey: 0 },
  cloudy: { sun: 0.45, sky: 0.8, fogFar: 3200, grey: 0.55 },
  rain: { sun: 0.18, sky: 0.55, fogFar: 1200, grey: 0.8 },
  storm: { sun: 0.08, sky: 0.35, fogFar: 750, grey: 0.92 },
};

const DAY = new Color(0.2, 0.42, 0.82);
const DUSK = new Color(0.62, 0.36, 0.3);
const NIGHT = new Color(0.014, 0.022, 0.05);
const GREY = new Color(0.42, 0.45, 0.48);
const WHITE = new Color(1, 1, 1);
const MOON = new Color(0.3, 0.38, 0.58);

export class Environment {
  readonly sun = new DirectionalLight(0xffffff, 1);
  readonly ambient = new HemisphereLight(0xffffff, 0x3a3428, 1);
  readonly sea: Mesh;
  readonly seaMaterial: MeshStandardNodeMaterial;
  private readonly sky = new Color();
  private readonly fog = new Fog(0x000000, 60, 3000);
  sunAltitudeDeg = 0;

  constructor(scene: Scene) {
    this.seaMaterial = new MeshStandardNodeMaterial({
      color: new Color(0.012, 0.07, 0.095),
      roughness: 0.22,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
    });
    this.seaMaterial.name = 'sea';
    const plane = new PlaneGeometry(9000, 9000, 1, 1);
    plane.rotateX(-Math.PI / 2);
    this.sea = new Mesh(plane, this.seaMaterial);
    this.sea.name = 'sea';
    this.sea.renderOrder = 1;
    scene.add(this.sun, this.sun.target, this.ambient, this.sea);
    scene.fog = this.fog;
    scene.background = this.sky;
  }

  /** Recomputes sun, sky and fog. Called on parameter changes, never per frame. */
  set(hour: number, weather: Weather): void {
    const w = WEATHER[weather];
    const hourAngle = ((hour - 12) * 15 * Math.PI) / 180;
    const east = -Math.cos(DECLINATION) * Math.sin(hourAngle);
    const north = Math.cos(LATITUDE) * Math.sin(DECLINATION) - Math.sin(LATITUDE) * Math.cos(DECLINATION) * Math.cos(hourAngle);
    const up = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(hourAngle);
    this.sunAltitudeDeg = (Math.asin(up) * 180) / Math.PI;

    const day = smooth(-0.1, 0.25, up);
    const dusk = smooth(-0.14, 0.02, up) * (1 - smooth(0.02, 0.3, up));
    this.sky.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk * 0.55).lerp(GREY, w.grey * day);
    this.sky.multiplyScalar(0.35 + 0.65 * w.sky);
    this.fog.color.copy(this.sky);
    this.fog.near = w.fogFar * 0.3;
    this.fog.far = w.fogFar;

    // Keep the light above the horizon so night scenes still get moon-like fill.
    const lightUp = Math.max(up, 0.12);
    this.sun.position.set(east * 1000, lightUp * 1000, -north * 1000);
    this.sun.target.position.set(0, 0, 0);
    const night = 1 - Math.max(day, dusk);
    this.sun.color.setRGB(1, 0.96 - 0.3 * dusk, 0.9 - 0.5 * dusk).lerp(MOON, night);
    // The same light doubles as the moon at night; weather dims it only partly.
    this.sun.intensity = 3.4 * smooth(-0.02, 0.35, up) * w.sun + 0.9 * night * (0.5 + 0.5 * w.sun);
    this.ambient.color.copy(this.sky);
    // Moonlit floor at night so silhouettes stay readable until the sky model lands.
    this.ambient.color.lerp(WHITE, 0.45).lerp(MOON, night);
    this.ambient.intensity = 0.55 + 0.6 * night + 0.35 * dusk + 0.5 * day * w.sky;
  }
}

function smooth(edge0: number, edge1: number, x: number): number {
  let t = (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
