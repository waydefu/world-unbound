"""Make three isolated grass shoots, render blind plates, and export GLB meshes.

Run with Blender 4.3: blender -b -t 3 --python-exit-code 1 -P build.py -- OUTPUT_DIR
World coordinates are metres. Panel identifiers are assigned in the build, not in the render.
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

UP = Vector((0, 0, 1))
ZERO = Vector((0, 0, 0))


def material(name, rgb, roughness=0.78):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Specular IOR Level"].default_value = 0.24
    return result


class MeshDraft:
    def __init__(self, palette):
        self.palette = palette
        self.positions = []
        self.faces = []
        self.colors = []

    def add(self, positions, faces, color):
        offset = len(self.positions)
        self.positions.extend(positions)
        self.faces.extend(tuple(offset + index for index in face) for face in faces)
        self.colors.extend([color] * len(faces))

    def object(self, name):
        data = bpy.data.meshes.new(name)
        data.from_pydata(self.positions, [], self.faces)
        if data.validate():
            raise ValueError("invalid sample mesh")
        for item in self.palette:
            data.materials.append(item)
        for polygon, color in zip(data.polygons, self.colors, strict=True):
            polygon.material_index = color
            polygon.use_smooth = True
        result = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(result)
        return result


def bezier(points, t):
    a, b, c, d = points
    s = 1 - t
    return a * s**3 + 3 * b * s*s*t + 3 * c * s*t*t + d * t**3


def direction(angle):
    return Vector((math.cos(angle), math.sin(angle), 0))


def ribbon(draft, origin, angle, run, tip_height, crest, width, fold, color):
    forward = direction(angle)
    right = direction(angle + math.pi / 2)
    points = (
        origin,
        origin + forward * (run * 0.06) + UP * (crest * 0.62),
        origin + forward * (run * 0.58) + UP * crest,
        origin + forward * run + UP * tip_height,
    )
    vertices, faces = [], []
    rows = 16
    for index in range(rows):
        t = index / rows
        center = bezier(points, t)
        half = width * (0.47 + 0.6 * math.sin(math.pi * t)) * (1 - t)**0.63 / 2
        roll = math.radians(12 + 32 * t)
        across = right * math.cos(roll) + UP * math.sin(roll)
        vertices.extend((center - across * half, center + UP * (half * fold), center + across * half))
        if index:
            a = (index - 1) * 3
            faces.extend(((a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)))
    vertices.append(points[-1])
    a = (rows - 1) * 3
    faces.extend(((a, rows * 3, a + 1), (a + 1, rows * 3, a + 2)))
    draft.add(vertices, faces, color)


def tube(draft, centers, start_radius, end_radius, color, sides=5):
    vertices, faces = [], []
    last = len(centers) - 1
    for index, center in enumerate(centers):
        axis = (centers[min(index + 1, last)] - centers[max(index - 1, 0)]).normalized()
        x = axis.cross(Vector((0, 1, 0))).normalized()
        if x.length == 0:
            x = axis.cross(Vector((1, 0, 0))).normalized()
        y = axis.cross(x)
        radius = start_radius + (end_radius - start_radius) * index / last
        for side in range(sides):
            angle = side * 2 * math.pi / sides
            vertices.append(center + radius * (math.cos(angle) * x + math.sin(angle) * y))
        if index:
            a, b = (index - 1) * sides, index * sides
            for side in range(sides):
                next_side = (side + 1) % sides
                faces.append((a + side, a + next_side, b + next_side, b + side))
    draft.add(vertices, faces, color)


def spikelet(draft, start, end, width, color):
    axis = (end - start).normalized()
    right = axis.cross(Vector((0, 1, 0))).normalized() * (width / 2)
    center = start.lerp(end, 0.55)
    ridge = axis.cross(right) * 0.55
    draft.add([start, center - right, center + ridge, center + right, end],
              [(0, 2, 1), (0, 3, 2), (1, 2, 4), (2, 3, 4), (0, 1, 4, 3)], color)


def leaves(draft, sizes):
    for index, (angle, run, tip, crest, width, fold) in enumerate(sizes):
        root = direction(math.radians(angle)) * 0.00055 + UP * (index % 3 * 0.00085)
        ribbon(draft, root, math.radians(angle), run, tip, crest, width, fold, index % 3)


def fescue(draft):
    leaves(draft, [
        (82, 0.059, 0.052, 0.121, 0.00093, 0.75),
        (204, 0.054, 0.018, 0.098, 0.00095, 0.80),
        (321, 0.046, 0.061, 0.119, 0.00072, 0.65),
        (152, 0.033, 0.077, 0.105, 0.00078, 0.82),
        (23, 0.057, 0.019, 0.070, 0.00089, 0.74),
        (257, 0.054, 0.015, 0.068, 0.00067, 0.83),
        (112, 0.026, 0.104, 0.113, 0.00073, 0.72),
    ])
    tube(draft, [ZERO, Vector((0.00045, 0, 0.004)), Vector((0.00072, 0, 0.008))], 0.0011, 0.00045, 3)


def bent(draft):
    leaves(draft, [
        (23, 0.081, 0.038, 0.098, 0.0025, 0.14),
        (161, 0.074, 0.022, 0.090, 0.00175, 0.24),
        (248, 0.026, 0.099, 0.116, 0.0014, 0.20),
        (311, 0.057, 0.044, 0.094, 0.00185, 0.12),
        (87, 0.058, 0.077, 0.121, 0.00195, 0.17),
    ])
    spine = [Vector((0.042 * t*t, 0.012 * t*t, 0.242 * t)) for t in (0, .18, .42, .62, .78, .9, 1)]
    tube(draft, spine, 0.00067, 0.00014, 1)
    ribbon(draft, spine[2], 2.22, 0.042, 0.039, 0.058, 0.0017, 0.15, 1)
    rng = random.Random(21)
    for whorl, center in enumerate(spine[3:-1]):
        heads = 5 - whorl
        for index in range(heads):
            angle = (index + 0.34 * whorl) * math.tau / heads + rng.uniform(-0.20, 0.20)
            side = direction(angle)
            length = 0.038 - 0.010 * whorl + rng.uniform(-0.004, 0.004)
            hook = center + side * length * 0.58 + UP * 0.009
            tip = center + side * length + UP * (0.026 + rng.uniform(-0.005, 0.005))
            tube(draft, [center, hook, tip], 0.00017, 0.00005, 2, sides=4)
            for along in (0.58, 0.82, 1.0):
                base = hook.lerp(tip, along)
                fork = base + direction(angle + (along - 0.78) * 6) * 0.005 + UP * 0.005
                tube(draft, [base, fork], 0.00007, 0.00004, 2, sides=3)
                spikelet(draft, fork, fork + UP * 0.0029 + side * 0.0011, 0.00095, 4 + rng.randrange(2))


def vernal(draft):
    leaves(draft, [
        (36, 0.073, 0.062, 0.134, 0.00335, 0.19),
        (141, 0.075, 0.028, 0.101, 0.0031, 0.11),
        (222, 0.043, 0.052, 0.101, 0.00285, 0.15),
        (312, 0.049, 0.081, 0.116, 0.00245, 0.26),
    ])
    spine = [Vector((0.008 * t + 0.04 * t**4, -0.024 * t**3, 0.275 * t)) for t in (0,.18,.40,.61,.78,.9,1)]
    tube(draft, spine, 0.00085, 0.00035, 1, sides=6)
    ribbon(draft, spine[2], 2.67, 0.041, 0.059, 0.072, 0.003, 0.16, 0)
    ribbon(draft, spine[3], 5.25, 0.027, 0.054, 0.060, 0.00225, 0.17, 1)
    base = spine[-1]
    head = [base + Vector((0.016 * (i / 11)**1.3, -0.011 * i / 11, 0.043 * i / 11)) for i in range(12)]
    tube(draft, head, 0.00037, 0.00009, 4)
    for i, node in enumerate(head[:-1]):
        t = i / 11
        radius = (0.0011 + 0.0036 * math.sin(math.pi * (0.12 + 0.84 * t))) * (1 - 0.64 * t)
        for offset in (0, math.pi):
            side = direction(i * 2.39996 + offset)
            root = node + side * (radius * 0.49)
            end = node + side * radius + UP * (0.0072 - t * 0.0026)
            spikelet(draft, root, end, 0.00245 - t * 0.00125, 4 + (i % 3 == 0))


SAMPLES = {
    "A": (vernal, 0.34),
    "B": (fescue, 0.15),
    "C": (bent, 0.29),
}


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area(name, point, power, size):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy, data.shape, data.size = power, "DISK", size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = point
    aim(obj, (0, 0, 0.13))


def render_setup():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.world.color = (0.34, 0.34, 0.34)
    scene.view_settings.view_transform = "AgX"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 880
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    area("Overcast key", (-0.42, -0.38, 0.65), 14, 0.44)
    area("Sky fill", (0.39, -0.12, 0.53), 8, 0.36)
    area("Soft rim", (0.12, 0.43, 0.50), 7, 0.30)
    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Sample camera"))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.clip_start = 0.02
    camera.data.clip_end = 25
    return scene, camera


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    palette = [
        material("Fine green leaf", (0.102, 0.212, 0.037)),
        material("Stem green", (0.071, 0.151, 0.030)),
        material("Young green leaf", (0.144, 0.248, 0.060)),
        material("Basal sheath", (0.114, 0.068, 0.039)),
        material("Pale inflorescence", (0.277, 0.247, 0.094)),
        material("Mature inflorescence", (0.234, 0.159, 0.066)),
    ]
    scene, camera = render_setup()
    for label, (build, height) in SAMPLES.items():
        draft = MeshDraft(palette)
        build(draft)
        specimen = draft.object(f"Specimen {label}")
        specimen.data.calc_loop_triangles()
        count = len(specimen.data.loop_triangles)
        print(f"SPECIMEN {label}: {len(specimen.data.vertices)} vertices, {count} triangles", flush=True)
        bpy.ops.object.select_all(action="DESELECT")
        specimen.select_set(True)
        bpy.context.view_layer.objects.active = specimen
        bpy.ops.export_scene.gltf(filepath=str(output / f"{label}.glb"), export_format="GLB", use_selection=True)
        camera.data.ortho_scale = height * 1.38
        for angle, view in ((-68, "front"), (26, "side")):
            radial = direction(math.radians(angle))
            camera.location = radial * 1.05 + UP * (height / 2 + 0.10)
            aim(camera, (0, 0, height * 0.49))
            scene.render.filepath = str(output / f"{label}-{view}.png")
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(specimen, do_unlink=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
run(parser.parse_args(sys.argv[sys.argv.index("--") + 1:]).output)
