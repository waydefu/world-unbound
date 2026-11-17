import { Constants } from '@babylonjs/core/Engines/constants';
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { CHUNK_SIZE } from '../src/world/constants';
import { LIGHTING, type Pose } from './sceneData';
import type { Runner, RunnerFactory } from './runner';

async function createEngine(canvas: HTMLCanvasElement, backend: 'webgpu' | 'webgl2'): Promise<AbstractEngine> {
  if (backend === 'webgpu' && 'gpu' in navigator) {
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
      powerPreference: 'high-performance',
      // Filtered against the adapter by Babylon; absent features are dropped.
      deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
    });
    await engine.initAsync();
    if (engine.getCaps().timerQuery || (engine as unknown as { _adapterSupportedExtensions: string[] })._adapterSupportedExtensions.includes('timestamp-query')) {
      engine.enableGPUTimingMeasurements = true;
    }
    return engine;
  }
  return new Engine(canvas, true, { powerPreference: 'high-performance' });
}

export const createBabylonRunner: RunnerFactory = async (canvas, data, options) => {
  const engine = await createEngine(canvas, options.backend);
  const isWebgpu = engine instanceof WebGPUEngine;
  engine.setSize(options.width, options.height);

  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(LIGHTING.sky[0], LIGHTING.sky[1], LIGHTING.sky[2], 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = LIGHTING.fogNear;
  scene.fogEnd = LIGHTING.fogFar;
  scene.fogColor = new Color3(LIGHTING.sky[0], LIGHTING.sky[1], LIGHTING.sky[2]);
  scene.imageProcessingConfiguration.toneMappingEnabled = false;

  const [sx, sy, sz] = LIGHTING.sunDirection;
  const sun = new DirectionalLight('sun', new Vector3(-sx, -sy, -sz), scene);
  sun.intensity = LIGHTING.sunIntensity;
  const ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  ambient.intensity = LIGHTING.ambientIntensity;
  ambient.diffuse = new Color3(LIGHTING.sky[0], LIGHTING.sky[1], LIGHTING.sky[2]);
  ambient.groundColor = new Color3(0.23, 0.2, 0.16);

  const material = new PBRMaterial('terrain', scene);
  material.albedoColor = Color3.White();
  material.metallic = 0;
  material.roughness = 0.96;
  // Terrain triangles wind counter-clockwise seen from above (three.js convention).
  material.sideOrientation = Constants.MATERIAL_CounterClockWiseSideOrientation;

  for (let i = 0; i < data.chunks.length; i++) {
    const chunk = data.chunks[i];
    const mesh = new Mesh(`chunk${i}`, scene);
    const vertexData = new VertexData();
    vertexData.positions = chunk.mesh.positions;
    vertexData.normals = chunk.mesh.normals;
    const colors = new Float32Array(chunk.mesh.colors.length);
    for (let k = 0; k < colors.length; k++) colors[k] = chunk.mesh.colors[k] / 255;
    vertexData.colors = colors;
    vertexData.indices = data.indices[chunk.lod];
    vertexData.applyToMesh(mesh, false);
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    mesh.material = material;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    // Snapshot rendering replays the draws recorded once, without re-culling,
    // so every chunk must be part of the recording.
    if (options.snapshot) mesh.alwaysSelectAsActiveMesh = true;
  }

  const camera = new FreeCamera('camera', Vector3.Zero(), scene);
  camera.fov = (LIGHTING.fovDeg * Math.PI) / 180;
  camera.minZ = LIGHTING.near;
  camera.maxZ = LIGHTING.far;
  camera.inputs.clear();
  const instrumentation = new SceneInstrumentation(scene);

  await scene.whenReadyAsync();
  material.freeze();

  const renderFrame = (): void => {
    engine.beginFrame();
    scene.render();
    engine.endFrame();
  };
  renderFrame();
  let snapshotActive = false;
  if (options.snapshot && isWebgpu) {
    engine.snapshotRenderingMode = Constants.SNAPSHOTRENDERING_FAST;
    engine.snapshotRendering = true;
    snapshotActive = true;
  }

  const target = new Vector3();
  const runner: Runner = {
    engine: options.snapshot ? 'babylon-snapshot' : 'babylon',
    backend: isWebgpu ? 'webgpu' : 'webgl2',
    gpuScope: 'main render pass only (gpuTimeInFrameForMainPass)',
    snapshotActive,
    setPose(pose: Pose) {
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      target.set(pose.target[0], pose.target[1], pose.target[2]);
      camera.setTarget(target);
    },
    render: renderFrame,
    drawCalls() {
      return instrumentation.drawCallsCounter.current;
    },
    afterFrame() {
      /* Babylon resolves its own timestamp queries. */
    },
    gpuMs() {
      const counter = (engine as WebGPUEngine).gpuTimeInFrameForMainPass?.counter;
      return counter && counter.current > 0 ? counter.current / 1e6 : null;
    },
    dispose() {
      scene.dispose();
      engine.dispose();
    },
  };
  return runner;
};
