import {
  BufferAttribute, BufferGeometry, BundleGroup, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh,
  MeshStandardNodeMaterial, NoToneMapping, PerspectiveCamera, Scene, WebGPURenderer,
} from 'three/webgpu';
import { CHUNK_SIZE } from '../src/world/constants';
import { LIGHTING, type Pose } from './sceneData';
import type { Runner, RunnerFactory } from './runner';

export const createThreeRunner: RunnerFactory = async (canvas, data, options) => {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: options.backend === 'webgl2',
    powerPreference: 'high-performance',
    trackTimestamp: true,
  });
  await renderer.init();
  const isWebgpu = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  renderer.toneMapping = NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setSize(options.width, options.height, false);

  const scene = new Scene();
  const sky = new Color(...LIGHTING.sky);
  scene.background = sky;
  scene.fog = new Fog(sky, LIGHTING.fogNear, LIGHTING.fogFar);
  const sun = new DirectionalLight(0xffffff, LIGHTING.sunIntensity);
  sun.position.set(LIGHTING.sunDirection[0] * 1000, LIGHTING.sunDirection[1] * 1000, LIGHTING.sunDirection[2] * 1000);
  scene.add(sun, sun.target, new HemisphereLight(sky, 0x3a3428, LIGHTING.ambientIntensity));

  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const indices = data.indices.map((array) => new BufferAttribute(array, 1));
  // Render bundles exist only on the WebGPU backend; elsewhere the group is a plain Group.
  const bundles = options.snapshot && isWebgpu;
  const terrain = bundles ? new BundleGroup() : new Group();
  scene.add(terrain);
  for (const chunk of data.chunks) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(chunk.mesh.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(chunk.mesh.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(chunk.mesh.colors, 4, true));
    geometry.setIndex(indices[chunk.lod]);
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // A bundle is recorded once from the camera at that moment; chunks culled
    // then would never appear, so in bundle mode every chunk is recorded.
    if (options.snapshot) mesh.frustumCulled = false;
    terrain.add(mesh);
  }

  const camera = new PerspectiveCamera(LIGHTING.fovDeg, options.width / options.height, LIGHTING.near, LIGHTING.far);
  await renderer.compileAsync(scene, camera);

  // three.js keeps one timestamp pair per render context and overwrites it every
  // frame, so a resolve returns the most recent frame's GPU time, not a sum.
  const timestamps = isWebgpu && renderer.hasFeature('timestamp-query');
  let pending = false;
  let lastGpu: number | null = null;

  const runner: Runner = {
    engine: options.snapshot ? 'three-bundle' : 'three',
    backend: isWebgpu ? 'webgpu' : 'webgl2',
    gpuScope: 'all render passes (trackTimestamp)',
    snapshotActive: bundles,
    setPose(pose: Pose) {
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    },
    render() {
      renderer.render(scene, camera);
    },
    drawCalls() {
      return renderer.info.render.drawCalls;
    },
    afterFrame() {
      if (!timestamps || pending) return;
      pending = true;
      void renderer.resolveTimestampsAsync('render').then((latest) => {
        if (typeof latest === 'number' && latest > 0) lastGpu = latest;
        pending = false;
      });
    },
    gpuMs() {
      return lastGpu;
    },
    dispose() {
      renderer.dispose();
    },
  };
  return runner;
};
