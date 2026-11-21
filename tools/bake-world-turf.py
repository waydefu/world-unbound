"""Derive the runtime master and directional canopy directly from the approved SOD1 asset.

python3 tools/bake-world-turf.py assets/grass/sod-full.bin assets/grass
"""
import gzip
from pathlib import Path
import struct
import sys

import numpy as np


LEAVES, VERTICES, CROWNS = 79524, 19, 8836
WIDTH = 2048
DIM, LAYERS, AREA_RANGE = 256, 3, 10


def master(path):
    data = gzip.decompress(path.read_bytes())
    signature, leaves, vertices, indices, _, _ = struct.unpack_from('<4s5I', data)
    if (signature, leaves, vertices, indices) != (b'SOD1', LEAVES, VERTICES, 66):
        raise ValueError('Expected the complete, approved fine fescue master')
    triangles = np.frombuffer(data, '<u4', indices, 24).reshape(-1, 3)
    first = 24 + 4 * indices
    lane = 12 * leaves * vertices
    attributes = []
    for i in range(3):
        packed = np.frombuffer(data, np.uint8, lane, first + i * lane)
        attributes.append(np.ascontiguousarray(packed.reshape(12, -1).T).view('<f4').reshape(leaves, vertices, 3))
    return *attributes, triangles


def attributes(points, normals, colours, path):
    local = points.reshape(CROWNS, 9, VERTICES, 3).copy()
    centres = local[:, :, 1].mean(axis=1)
    centres[:, 1] = 0
    local -= centres[:, None, None, :]
    if np.max(np.abs(local)) >= .16:
        raise ValueError('Master exceeds quantization bounds')
    xyz = np.rint((local.reshape(-1, 3) / .32 + .5) * 65535).astype(np.uint16)
    n = normals.reshape(-1, 3)
    n = n / np.maximum(1e-6, np.abs(n).sum(axis=1, keepdims=True))
    octa = np.where(n[:, 2:3] < 0, (1 - np.abs(n[:, 1::-1])) * np.where(n[:, :2] >= 0, 1, -1), n[:, :2])
    pigment = np.rint(colours.reshape(-1, 3).clip(0, 1) * 255).astype(np.uint8)
    count = len(xyz)
    height = (count + WIDTH - 1) // WIDTH
    pages = np.zeros((3, height * WIDTH, 4), dtype=np.uint8)
    pages[0, :count, :3], pages[1, :count, :3] = xyz & 255, xyz >> 8
    pages[0, :count, 3], pages[1, :count, 3] = pigment[:, 0], pigment[:, 1]
    pages[2, :count, :2] = np.rint((octa.clip(-1, 1) + 1) * 127.5)
    pages[2, :count, 2] = pigment[:, 2]
    centres_packed = np.rint((centres[:, [0, 2]] + .5) * 65535).astype('<u2')
    header = struct.pack('<4s4I', b'WTM2', LEAVES, WIDTH, height, 3)
    path.write_bytes(gzip.compress(header + pages.tobytes() + centres_packed.tobytes(), compresslevel=6, mtime=0))
    print('master leaves', LEAVES, 'compressed bytes', path.stat().st_size, flush=True)


def canopy(points, colours, triangles, path):
    edges = np.array([.025, .055], dtype=np.float32)
    geometry = points.copy()
    geometry[:, :, 1] -= points[:, 1:2, 1]
    samples = (np.arange(4, dtype=np.float32) + .5) / 4
    u, v = np.meshgrid(np.sqrt(samples), samples, indexing='ij')
    bary = np.stack((1 - u, u * (1 - v), u * v), axis=-1).reshape(-1, 3)
    total = np.zeros((5, DIM * DIM * LAYERS), dtype=np.float64)
    for start in range(0, LEAVES, 2500):
        tri = geometry[start:start + 2500, triangles].reshape(-1, 3, 3)
        normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]) * (.5 / len(bary))
        area = np.linalg.norm(normal, axis=1)
        pigment = colours[start:start + 2500, triangles, 1].mean(axis=-1).flatten()
        weights = np.repeat(np.column_stack((np.abs(normal), area * pigment, area)), len(bary), axis=0)
        p = (bary @ tri).reshape(-1, 3)
        x, z = (p[:, 0] + .5) * DIM - .5, (p[:, 2] + .5) * DIM - .5
        ix, iz = np.floor(x).astype(np.int32), np.floor(z).astype(np.int32)
        layer = np.searchsorted(edges, p[:, 1])
        dx, dz = x - ix, z - iz
        for ox, wx in ((0, 1-dx), (1, dx)):
            for oz, wz in ((0, 1-dz), (1, dz)):
                texel = (ix + ox) % DIM + DIM * ((iz + oz) % DIM) + DIM ** 2 * layer
                for channel in range(total.shape[0]):
                    total[channel] += np.bincount(texel, weights[:, channel] * wx * wz, minlength=total.shape[1])
    area = total[:3].T * DIM ** 2
    pigment = np.divide(total[3], total[4], out=np.full_like(total[3], .23), where=total[4] > 0)
    packed = np.rint(np.column_stack((area * (255 / AREA_RANGE), pigment * 255))).clip(0, 255).astype(np.uint8)
    path.write_bytes(struct.pack('<4sIHHf', b'WTV1', LEAVES, DIM, LAYERS, AREA_RANGE) + packed.tobytes())
    print('projected leaf area X/Y/Z', total[:3].sum(axis=1), 'unprojected', total[4].sum(), flush=True)


if __name__ == '__main__':
    source, target = map(Path, sys.argv[1:])
    p, n, c, t = master(source)
    attributes(p, n, c, target / 'sod-world-master.bin')
    canopy(p, c, t, target / 'sod-world-canopy.bin')
