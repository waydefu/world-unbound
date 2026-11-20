"""Bake three runtime representations from the 1 m fine-fescue Blender master.

blender -b fescue-sod.blend -t 2 --python-exit-code 1 -P tools/bake-sod.py -- extract /tmp/sod.npz
python3 tools/bake-sod.py /tmp/sod.npz assets/grass
"""
from pathlib import Path
import struct
import sys

import numpy as np


def extract(path):
    import bpy

    source = bpy.data.objects["Fine fescue · authored blade canopy"]
    mesh = source.data
    count = int(source["blades"])
    points = np.empty(count * 19 * 3, dtype=np.float32)
    colours = np.empty(count * 19 * 4, dtype=np.float32)
    mesh.vertices.foreach_get("co", points)
    mesh.color_attributes["Leaf tint"].data.foreach_get("color", colours)
    np.savez(path, points=points.reshape(count, 19, 3), colours=colours.reshape(count, 19, 4))


def triangles(rows):
    faces = []
    for row in range(rows - 1):
        a = row * 3
        faces.extend(((a, a+3, a+4), (a, a+4, a+1), (a+1, a+4, a+5), (a+1, a+5, a+2)))
    a = (rows - 1) * 3
    faces.extend(((a, rows * 3, a+1), (a+1, rows * 3, a+2)))
    return np.asarray(faces, dtype=np.int32)


def bake_near(points, colours, output):
    # This crown mixes short, bowed and standing leaves from the centre of the master.
    selected = (47 * 94 + 47) * 9 + np.array([0, 1, 2, 4, 5, 7, 8])
    rows = [0, 1, 2, 3, 5]
    vertices = np.array([row * 3 + col for row in rows for col in (0, 1, 2)] + [18])
    p = points[selected][:, vertices].copy()
    p -= p[:, 1].mean(axis=0)
    # Blender's Z-up to the game's Y-up. Negate Y to preserve mesh orientation.
    p = p[:, :, [0, 2, 1]].reshape(-1, 3)
    p[:, 2] *= -1
    indices = (triangles(len(rows))[None] + (np.arange(len(selected)) * len(vertices))[:, None, None]).reshape(-1, 3)
    a, b, c = p[indices].transpose(1, 0, 2)
    per_face = np.cross(b-a, c-a)
    n = np.zeros_like(p)
    for column in indices.T:
        np.add.at(n, column, per_face)
    n /= np.linalg.norm(n, axis=1, keepdims=True).clip(1e-12)
    rgb = colours[selected][:, vertices, :3].reshape(-1, 3)
    with output.open("wb") as dst:
        dst.write(struct.pack("<2I", len(p), indices.size))
        dst.write(np.column_stack((p, n, rgb)).astype("<f4").tobytes())
        dst.write(indices.astype("<u2").tobytes())


def bake_side(points, colours, output):
    from PIL import Image, ImageChops, ImageDraw

    width, height, samples = 512, 256, 3
    # Project a 27 cm strip through a 2.8 cm depth of the real master, at metre scale.
    span, rise = .27, .12
    root = points[:, 1]
    inside = (np.abs(root[:, 0]) < span / 2) & (np.abs(root[:, 1]) < .014)
    geo = points[inside][:, triangles(6)].reshape(-1, 3, 3)
    green = colours[inside][:, triangles(6), 1].reshape(-1, 3).mean(axis=1)
    shade = np.rint(67 + green * 466).clip(133, 247).astype(np.uint8)
    alpha = Image.new("L", (width * samples, height * samples))
    light = Image.new("L", alpha.size, 184)
    opacity, tones = ImageDraw.Draw(alpha), ImageDraw.Draw(light)
    for i in np.argsort(-geo[:, :, 1].mean(axis=1), kind="stable"):
        tri = geo[i]
        x = (tri[:, 0] / span + .5) * width * samples
        y = (1 - tri[:, 2] / rise) * height * samples
        for shift in (-alpha.width, 0, alpha.width):
            if x.max()+shift < 0 or x.min()+shift >= alpha.width:
                continue
            xy = list(zip(x+shift, y))
            opacity.polygon(xy, fill=255)
            tones.polygon(xy, fill=int(shade[i]))
    alpha = alpha.resize((width, height), Image.Resampling.LANCZOS)
    light = light.resize((width, height), Image.Resampling.LANCZOS)
    feather = Image.new("L", (width, 1))
    feather.putdata([round(255 * min(1, min(x+.5,width-x-.5)/(width*.08))**.75) for x in range(width)])
    alpha = ImageChops.multiply(alpha, feather.resize((width, height)))
    output.write_bytes(Image.merge("LA", (alpha, light)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes())
    print("side projected blades", int(inside.sum()))


def bake_top(points, colours, output):
    size = 512
    heights = np.zeros(size**2, dtype=np.float32)
    pixels = np.zeros((size**2, 4), dtype=np.uint8)
    pixels[:, 0] = 150
    pixels[:, 2:4] = 128
    root_to_tip = points[:, -1, :2] - points[:, 1, :2]
    root_to_tip /= np.linalg.norm(root_to_tip, axis=1, keepdims=True).clip(1e-8)
    cardinals = np.rint(root_to_tip * [127, -127] + 128).clip(0,255).astype(np.uint8)
    endpoints = np.concatenate((points[:, :18].reshape(-1, 6, 3, 3), np.repeat(points[:, -1:, None, :], 3, axis=2)), axis=1)
    pigment = np.concatenate((colours[:, :18, 1].reshape(-1, 6, 3), np.repeat(colours[:, -1:, 1, None], 3, axis=2)), axis=1)
    # Splat the actual blade strips at sub-texel intervals, wrapping overshooting leaf tips.
    for row in range(6):
        for t in np.linspace(0, 1, 23, dtype=np.float32):
            section = endpoints[:, row] * (1-t) + endpoints[:, row+1] * t
            linear_green = pigment[:, row] * (1-t) + pigment[:, row+1] * t
            for edge in (0, 2):
                for fraction in (0, .5, 1):
                    p = section[:, 1] * (1-fraction) + section[:, edge] * fraction
                    shade = linear_green[:, 1]*(1-fraction) + linear_green[:, edge]*fraction
                    q = (np.floor((p[:, 0]+.5)*size).astype(np.int32) & (size-1)) + size*(np.floor((.5-p[:, 1])*size).astype(np.int32) & (size-1))
                    np.maximum.at(heights, q, p[:,2])
                    top = (heights[q] == p[:, 2]) & (p[:, 2] > 0)
                    ids = q[top]
                    pixels[ids, 0] = np.rint(96 + shade[top]*388).clip(124, 249)
                    pixels[ids, 1] = np.rint(p[top, 2]*255/.115).clip(1, 255)
                    pixels[ids, 2:4] = cardinals[top]
    output.write_bytes(pixels.tobytes())
    print("top cover", float((pixels[:,1] > 0).mean()))


if __name__ == "__main__":
    if "--" in sys.argv:
        mode, path = sys.argv[sys.argv.index("--")+1:]
        if mode != "extract":
            raise ValueError("Expected extract")
        extract(Path(path))
    else:
        source, dest = map(Path, sys.argv[1:])
        with np.load(source) as data:
            p, c = data["points"], data["colours"]
        if p.shape != (79524, 19, 3) or c.shape != (79524, 19, 4):
            raise ValueError("Unexpected fescue master geometry")
        dest.mkdir(parents=True, exist_ok=True)
        bake_near(p, c, dest/"sod-near.bin")
        bake_side(p, c, dest/"sod-side.bin")
        bake_top(p, c, dest/"sod-top.bin")
