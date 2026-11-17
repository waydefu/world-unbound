/** World-core constants. Units are metres; +x east, +y up, +z south. The world is a 4096 m square of Hellesylt, Norway. */
export const CELL_SIZE = 2;
export const CHUNK_CELLS = 32;
export const CHUNK_SIZE = CELL_SIZE * CHUNK_CELLS;
export const CHUNK_SAMPLES = CHUNK_CELLS + 1;
/** One-sample apron on every side so normals agree across chunk borders. */
export const TILE_APRON = 1;
export const TILE_DIM = CHUNK_SAMPLES + 2 * TILE_APRON;
export const WORLD_CHUNKS = 64;
export const WORLD_HALF_CHUNKS = WORLD_CHUNKS / 2;
export const WORLD_MIN = -WORLD_HALF_CHUNKS * CHUNK_SIZE;
export const WORLD_MAX = WORLD_HALF_CHUNKS * CHUNK_SIZE;
export const CHUNK_COUNT = WORLD_CHUNKS * WORLD_CHUNKS;
/**
 * Authoritative heights are Int16 integers: height = q * HEIGHT_QUANTUM + HEIGHT_OFFSET
 * (2 cm steps, range -55.36 .. 1255.34 m). Use dequantize/quantize in heightField.ts.
 */
export const HEIGHT_QUANTUM = 0.02;
export const HEIGHT_OFFSET = 600;
export const SEA_LEVEL = 0;
export const MAX_LOD = 4;
/** Bump when the baked terrain data or quantisation changes; caches and saves key on it. */
export const TERRAIN_VERSION = 2;
export const WORLD_SEED = 0x5a17a1d;

/**
 * Hellesylt village ground: centre of the largest flat (< 6 degree) land area within 700 m of
 * the origin that touches the fjord, found from the baked data (see the G1.5 phase B commit).
 */
export const TOWN_X = 150;
export const TOWN_Z = -210;
export const TOWN_RADIUS = 60;
