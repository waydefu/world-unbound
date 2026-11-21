/// <reference lib="webworker" />
import { type SoilMap, SoilWaterGrid } from '../world/soilWater';

export type SoilCommand =
  | { map: SoilMap; state: Float32Array }
  | { seconds: number; rain: number; evaporation: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let model: SoilWaterGrid | null = null;

scope.onmessage = ({ data }: MessageEvent<SoilCommand>) => {
  if ('map' in data) {
    model = new SoilWaterGrid(data.map, data.state);
    return;
  }
  if (!model) throw new Error('Soil worker has no initial state');
  model.step(data.seconds, data.rain, data.evaporation);
  const snapshot = model.state.slice();
  scope.postMessage(snapshot, [snapshot.buffer]);
};
