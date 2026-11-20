"""Pack approved specimens A/C from PR #31 as one-material runtime meshes.

Usage: python3 tools/bake-grass-specimens.py SPECIMEN_DIR OUTPUT.bin
Input GLBs are the metre-scale exports from docs/research/grass-specimens in c9025b9.
"""
import json
import math
import random
import struct
import sys
from pathlib import Path


def glb(path):
    data = path.read_bytes()
    magic, version, size, json_size, json_type = struct.unpack_from("<4s4I", data)
    if (magic, version, size, json_type) != (b"glTF", 2, len(data), 0x4E4F534A):
        raise ValueError(f"Unexpected GLB {path}")
    end = 20 + json_size
    document = json.loads(data[20:end])
    bin_size, bin_type = struct.unpack_from("<2I", data, end)
    if bin_type != 0x004E4942 or end + 8 + bin_size != len(data):
        raise ValueError(f"Missing binary mesh data in {path}")
    blob = memoryview(data)[end + 8:]

    def accessor(index, components):
        item = document["accessors"][index]
        view = document["bufferViews"][item["bufferView"]]
        element = struct.Struct("<" + {5123: "H", 5125: "I", 5126: "f"}[item["componentType"]] * components)
        offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
        stride = view.get("byteStride", element.size)
        return [element.unpack_from(blob, offset + stride * i) for i in range(item["count"])]

    vertices, indices = [], []
    for primitive in document["meshes"][0]["primitives"]:
        attrs = primitive["attributes"]
        positions = accessor(attrs["POSITION"], 3)
        normals = accessor(attrs["NORMAL"], 3)
        colour = document["materials"][primitive["material"]]["pbrMetallicRoughness"]["baseColorFactor"][:3]
        indices.extend(len(vertices) + index for (index,) in accessor(primitive["indices"], 1))
        vertices.extend((*position, *normal, *colour) for position, normal in zip(positions, normals, strict=True))
    return vertices, indices


def bake(folder, output):
    with output.open("wb") as stream:
        for name in ("A", "C"):
            vertices, indices = glb(folder / f"{name}.glb")
            stream.write(struct.pack("<2I", len(vertices), len(indices)))
            for vertex in vertices:
                stream.write(struct.pack("<9f", *vertex))
            stream.write(struct.pack("<" + "H" * len(indices), *indices))


def bake_tuft(folder, output):
    """Orthographic cutout of 32 actual sample B shoots, with supersampled leaf edges."""
    from PIL import Image, ImageDraw

    width, height = 512, 256
    span, rise = .24, .12
    oversample = 3
    rng = random.Random(7421)
    vertices, indices = glb(folder / "B.glb")
    triangle_mesh = [indices[i:i + 3] for i in range(0, len(indices), 3)]
    triangles = []
    for k in range(32):
        angle = rng.uniform(0, math.tau)
        c, sn = math.cos(angle), math.sin(angle)
        scale = rng.uniform(.73, 1.14)
        x0 = rng.uniform(-.071, .071)
        depth = rng.uniform(-.08, .08)
        coords = []
        for x, y, z, _, _, _, r, g, b in vertices:
            p = x0 + (c*x - sn*z)*scale
            q = y*scale + depth*.10
            d = depth + (sn*x + c*z)*scale
            shade = max(130, min(250, round(g * 640 + 44)))
            coords.append(((.5+p/span)*width, (1-q/rise)*height, d, shade))
        for face in triangle_mesh:
            points = [coords[i] for i in face]
            triangles.append((sum(p[2] for p in points), points))
    # Keep alpha and colour separate so the zero-coverage texels never bake a black fringe.
    opacity = Image.new("L", (width*oversample, height*oversample))
    shades = Image.new("L", opacity.size, 188)
    odraw, sdraw = ImageDraw.Draw(opacity), ImageDraw.Draw(shades)
    for _, points in sorted(triangles, key=lambda t: t[0]):
        face = [(x*oversample, y*oversample) for x, y, _, _ in points]
        odraw.polygon(face, fill=255)
        sdraw.polygon(face, fill=round(sum(p[3] for p in points)/3))
    alpha = opacity.resize((width, height), Image.Resampling.LANCZOS)
    shade = shades.resize((width, height), Image.Resampling.LANCZOS)
    texture = Image.merge("LA", (alpha, shade))
    output.write_bytes(texture.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes())


if __name__ == "__main__":
    source = Path(sys.argv[1])
    result = Path(sys.argv[2])
    bake(source, result)
    bake_tuft(source, result.with_name("fescue-tuft.bin"))
