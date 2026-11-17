/** World-core constants. Units are metres; +x east, +y up, +z south. The sea lies to the north (-z). */
export const CELL_SIZE = 2;
export const CHUNK_CELLS = 32;
export const CHUNK_SIZE = CELL_SIZE * CHUNK_CELLS;
export const CHUNK_SAMPLES = CHUNK_CELLS + 1;
/** One-sample apron on every side so normals agree across chunk borders. */
export const TILE_APRON = 1;
export const TILE_DIM = CHUNK_SAMPLES + 2 * TILE_APRON;
export const WORLD_CHUNKS = 32;
export const WORLD_HALF_CHUNKS = WORLD_CHUNKS / 2;
export const WORLD_MIN = -WORLD_HALF_CHUNKS * CHUNK_SIZE;
export const WORLD_MAX = WORLD_HALF_CHUNKS * CHUNK_SIZE;
export const CHUNK_COUNT = WORLD_CHUNKS * WORLD_CHUNKS;
/** Authoritative heights are integers in this quantum (1 cm, Int16 => +/-327.67 m). */
export const HEIGHT_QUANTUM = 0.01;
export const SEA_LEVEL = 0;
export const MAX_LOD = 4;
/** Bump when terrainShape or quantisation changes; caches and saves key on it. */
export const TERRAIN_VERSION = 1;
export const WORLD_SEED = 0x5a17a1d;

/** Town footprint (wall ring 500 m x 400 m) and waterfront line. */
export const TOWN_HALF_X = 250;
export const TOWN_HALF_Z = 200;
export const TOWN_GROUND_HEIGHT = 2.6;
export const QUAY_Z = -TOWN_HALF_Z - 15;
