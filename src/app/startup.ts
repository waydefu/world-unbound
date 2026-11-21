import type { SlidingRate } from '../perf/slidingRate';
import type { Ocean } from '../render/ocean';
import { COAST_DIM, SEAFLOOR_DIM } from '../world/seaFloor';
import type { TerrainBackend } from './terrainBackend';

export type StartupProgress = (percent: number, message: string) => void;

export function loadOceanFloor(terrain: TerrainBackend, ocean: Ocean, uploads: SlidingRate): void {
  void terrain.client.requestSeaFloor().then(heights => {
    ocean.setSeaFloor(heights);
    uploads.add(performance.now(), SEAFLOOR_DIM * SEAFLOOR_DIM * 2);
    terrain.seaFloorReady();
    if (ocean.hasCoast) {
      void terrain.client.requestSeaFloor(true).then(fine => {
        ocean.setCoastFloor(fine);
        uploads.add(performance.now(), COAST_DIM * COAST_DIM * 2);
      });
    }
  });
}
