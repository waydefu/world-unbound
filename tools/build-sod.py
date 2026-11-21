"""Render a 1 m by 1 m cultivated fine-fescue sod study with Blender 4.3 Cycles."""
import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector
import numpy as np


def options():
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=Path)
    parser.add_argument("--draft", action="store_true")
    parser.add_argument("--denoise", action="store_true", help="Use Cycles Open Image Denoise if the Blender build has it.")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--views", default="edge,standing,elevated,backlight")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def surface(name, shade, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*shade, 1)
    shader.inputs["Roughness"].default_value = roughness
    return mat, shader


def grain_surface(name, dark, light, scale, roughness, strength, distance):
    mat, shader = surface(name, dark, roughness)
    tree = mat.node_tree
    coords = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 3.0
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .22
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = .77
    ramp.color_ramp.elements[1].color = (*light, 1)
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = distance
    tree.links.new(coords.outputs["Object"], noise.inputs["Vector"])
    tree.links.new(noise.outputs["Fac"], ramp.inputs[0])
    tree.links.new(ramp.outputs[0], shader.inputs["Base Color"])
    tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


def leaf_surface():
    mat, reflection = surface("Fine fescue · blade tint and thin transmission", (.106, .227, .021), .49)
    tree = mat.node_tree
    reflection.inputs["Specular IOR Level"].default_value = .26
    tint = tree.nodes.new("ShaderNodeVertexColor")
    tint.layer_name = "Leaf tint"
    transmission = tree.nodes.new("ShaderNodeBsdfTranslucent")
    transmitted_tint = tree.nodes.new("ShaderNodeMixRGB")
    transmitted_tint.blend_type = "MULTIPLY"
    transmitted_tint.inputs[0].default_value = 1.0
    transmitted_tint.inputs[2].default_value = (1, .94, .52, 1)
    split = tree.nodes.new("ShaderNodeMixShader")
    split.inputs[0].default_value = .29
    tree.links.new(tint.outputs["Color"], reflection.inputs["Base Color"])
    tree.links.new(tint.outputs["Color"], transmitted_tint.inputs[1])
    tree.links.new(transmitted_tint.outputs[0], transmission.inputs["Color"])
    tree.links.new(reflection.outputs[0], split.inputs[1])
    tree.links.new(transmission.outputs[0], split.inputs[2])
    tree.links.new(split.outputs[0], tree.nodes.get("Material Output").inputs["Surface"])
    return mat


def cubic(p0, p1, p2, p3, t):
    inv = 1.0 - t
    return inv**3 * p0 + 3.0 * inv**2 * t * p1 + 3.0 * inv * t**2 * p2 + t**3 * p3


def soil_height(x, y):
    return .0015 * np.sin(23 * x + 15 * y) + .00095 * np.cos(44 * y - 37 * x)


def create_blades(draft):
    rng = np.random.default_rng(143825)
    grid = 68 if draft else 94
    count_per_crown = 9
    sample = np.arange(grid, dtype=np.float32)
    gx, gy = np.meshgrid(sample, sample)
    crown_x = ((gx.flatten() + rng.uniform(.06, .94, grid**2)) / grid - .5).repeat(count_per_crown)
    crown_y = ((gy.flatten() + rng.uniform(.06, .94, grid**2)) / grid - .5).repeat(count_per_crown)
    count = crown_x.size
    jitter = rng.uniform(0.0, np.pi * 2, count)
    radial = rng.uniform(.0005, .0100, count)
    x = np.clip(crown_x + np.cos(jitter) * radial, -.499, .499).astype(np.float32)
    y = np.clip(crown_y + np.sin(jitter) * radial, -.499, .499).astype(np.float32)
    z = (soil_height(x, y) - rng.uniform(.0004, .0028, count)).astype(np.float32)
    patch = .57 * np.sin(16 * x + 7 * y) * np.cos(15 * y - 4 * x) + .43 * np.sin(36 * x - 31 * y)
    orientation = .45 + .95 * np.sin(13 * y + 5 * x) + .46 * np.cos(25 * x + 9 * y)
    phi = np.where(rng.random(count) < .29, orientation + rng.normal(0, .65, count), jitter)
    dx, dy = np.cos(phi), np.sin(phi)
    posture = rng.random(count)
    standing = posture < .23
    laid = posture > .78
    arching = (posture > .63) & (posture <= .78)
    basal = posture > .90
    run = np.where(standing, rng.uniform(.013, .044, count), rng.uniform(.020, .064, count))
    run = np.where(laid, rng.uniform(.034, .071, count), run)
    tip = np.where(standing, rng.uniform(.035, .089, count), rng.uniform(.014, .057, count))
    tip = np.where(laid, rng.uniform(.002, .027, count), tip)
    crest = np.where(standing, tip * rng.uniform(.83, 1.32, count), rng.uniform(.042, .107, count))
    crest = np.where(laid, rng.uniform(.025, .051, count), crest)
    run = np.where(arching, rng.uniform(.052, .095, count), run)
    tip = np.where(arching, rng.uniform(.020, .042, count), tip)
    crest = np.where(arching, rng.uniform(.064, .101, count), crest)
    run = np.where(basal, rng.uniform(.018, .053, count), run)
    tip = np.where(basal, rng.uniform(.003, .016, count), tip)
    crest = np.where(basal, rng.uniform(.008, .024, count), crest)
    tip *= 1 + .28 * patch
    crest *= 1 + .28 * patch
    width = rng.uniform(.00050, .00132, count) * np.where(standing, .86, np.where(arching, 1.26, 1.0))
    roll0 = rng.uniform(-.38, .38, count)
    twist = rng.uniform(-1.38, 1.38, count)
    curl = rng.uniform(-.011, .011, count) * np.where(standing, .55, 1)
    fold = rng.uniform(.33, .94, count)

    rows = 6
    blade_verts = rows * 3 + 1
    points = np.empty((count, blade_verts, 3), dtype=np.float32)
    rgba = np.empty((count, blade_verts, 4), dtype=np.float32)
    young = rng.beta(2.2, 2.5, count)
    pigment = rng.uniform(.78, 1.22, count) * (1 + .10 * patch)
    age = rng.random(count)
    straw = age < np.where(laid, .085, .015)
    dark = np.column_stack((.044 + .079 * young, .112 + .137 * young, .009 + .020 * young))
    fresh_tip = np.column_stack((.077 + .123 * young, .205 + .194 * young, .020 + .037 * young))
    dark[basal] *= .77
    fresh_tip[basal] *= .85
    dark[straw] = (.093, .086, .028)
    fresh_tip[straw] = (.275, .231, .081)
    rim = np.asarray([1.015, .97, 1.045], dtype=np.float32)
    t_values = (0., .17, .35, .54, .72, .89)
    for row, t in enumerate(t_values):
        reach = cubic(0., .07 * run, .52 * run, run, t)
        height = cubic(0., .66 * crest, crest, tip, t)
        sideways = curl * np.sin(t * np.pi) * t
        half = .5 * width * (.47 + .69 * np.sin(np.pi * t)) * (1 - t)**.61
        roll = roll0 + twist * t
        lateral = half * np.cos(roll)
        vertical = half * np.sin(roll)
        cx = x + reach * dx - sideways * dy
        cy = y + reach * dy + sideways * dx
        cz = z + height
        a = row * 3
        points[:, a, :] = np.column_stack((cx + dy * lateral, cy - dx * lateral, cz - vertical))
        points[:, a + 1, :] = np.column_stack((cx, cy, cz + half * fold))
        points[:, a + 2, :] = np.column_stack((cx - dy * lateral, cy + dx * lateral, cz + vertical))
        rgb = ((1 - t) * dark + t * fresh_tip) * pigment[:, None]
        rgba[:, a:a + 3, :3] = rgb[:, None, :] * rim[None, :, None]
        rgba[:, a:a + 3, 3] = 1.0
    points[:, -1, :] = np.column_stack((x + run * dx, y + run * dy, z + tip))
    rgba[:, -1, :3] = fresh_tip * pigment[:, None]
    rgba[:, -1, 3] = 1.0
    face_template = []
    for row in range(rows - 1):
        a = row * 3
        face_template.extend(((a, a + 3, a + 4), (a, a + 4, a + 1),
                              (a + 1, a + 4, a + 5), (a + 1, a + 5, a + 2)))
    a = (rows - 1) * 3
    face_template.extend(((a, blade_verts - 1, a + 1), (a + 1, blade_verts - 1, a + 2)))
    faces = (np.asarray(face_template, dtype=np.int32)[None, :, :]
             + (np.arange(count, dtype=np.int32) * blade_verts)[:, None, None]).reshape(-1, 3)
    mesh = bpy.data.meshes.new("Fine fescue blade ribbons")
    mesh.vertices.add(points.size // 3)
    mesh.vertices.foreach_set("co", points.ravel())
    mesh.loops.add(faces.size)
    mesh.loops.foreach_set("vertex_index", faces.ravel())
    mesh.polygons.add(len(faces))
    mesh.polygons.foreach_set("loop_start", np.arange(0, faces.size, 3, dtype=np.int32))
    mesh.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
    leaf_color = mesh.color_attributes.new(name="Leaf tint", type="FLOAT_COLOR", domain="POINT")
    leaf_color.data.foreach_set("color", rgba.ravel())
    mesh.update(calc_edges=True)
    turf = bpy.data.objects.new("Fine fescue · authored blade canopy", mesh)
    bpy.context.collection.objects.link(turf)
    turf.data.materials.append(leaf_surface())
    turf["blades"], turf["footprint_m2"], turf["random_seed"] = int(count), 1.0, 143825
    turf["leaf_width_mm_p05_p50_p95"] = list(np.percentile(width * 1000, (5, 50, 95)))
    turf["leaf_peak_cm_p05_p50_p95"] = list(np.percentile(points[:, :, 2].max(axis=1) * 100, (5, 50, 95)))
    print(f"BLADES={count} VERTICES={len(mesh.vertices)} TRIANGLES={len(faces)}", flush=True)


def create_ground():
    litter = grain_surface("Root mat and soil", (.024, .017, .008), (.106, .077, .038), 194, .91, .34, .0013)
    floor = grain_surface("Neutral concrete photography floor", (.207, .207, .183), (.317, .312, .275), 142, .87, .18, .0010)
    n = 101
    line = np.linspace(-.5, .5, n)
    x, y = np.meshgrid(line, line)
    perimeter = (np.abs(x) > .499) | (np.abs(y) > .499)
    shift = .00072 * np.sin(184 * x + 111 * y) + .00053 * np.sin(318 * x - 96 * y)
    coords = list(zip((x + perimeter * shift * np.sign(x)).flatten(),
                      (y + perimeter * shift * np.sign(y)).flatten(),
                      soil_height(x, y).flatten()))
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i)
             for j in range(n - 1) for i in range(n - 1)]
    rim = list(range(n)) + [j * n + n - 1 for j in range(1, n)]
    rim += [(n - 1) * n + i for i in range(n - 2, -1, -1)] + [j * n for j in range(n - 2, 0, -1)]
    bottom = len(coords)
    for i in rim:
        px, py, _ = coords[i]
        coords.append((px * .998, py * .998, -.0324 + .00085 * np.sin(px * 94 + py * 29)))
    for i, a in enumerate(rim):
        b = (i + 1) % len(rim)
        faces.append((rim[b], a, bottom + i, bottom + b))
    mesh = bpy.data.meshes.new("Measured-size sod profile")
    mesh.from_pydata(coords, [], faces)
    mesh.update()
    mat = bpy.data.objects.new("1000 mm by 1000 mm root mat", mesh)
    bpy.context.collection.objects.link(mat)
    mat.data.materials.append(litter)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.032))
    bpy.context.object.name = "Neutral floor"
    bpy.context.object.data.materials.append(floor)


# The same physical sod and lens model are used in all four views.
VIEWS = {
    "edge": ((.27, -.84, .115), (.085, -.43, .018), 66, (1100, 800), (-.55, -.85, .84), 3.6),
    "standing": ((.35, -1.58, 1.62), (.01, -.04, .013), 54, (1060, 810), (-.62, -.79, 1.1), 3.3),
    "elevated": ((.12, -.34, 2.5), (0, 0, .013), 71, (1060, 950), (-.62, -.79, 1.1), 3.3),
    "backlight": ((.065, -.73, .188), (-.07, -.029, .039), 68, (1160, 790), (-.17, .89, .48), 4.2),
}


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def set_view(scene, name, draft):
    pos, target, lens, dims, light_from, strength = VIEWS[name]
    scene.camera.location = pos
    aim(scene.camera, target)
    scene.camera.data.lens = lens
    scene.render.resolution_x, scene.render.resolution_y = dims
    scene.render.resolution_percentage = 53 if draft else 100
    sun = bpy.data.objects["Direct sun"]
    sun.location = light_from
    aim(sun, (0, 0, 0))
    sun.data.energy = strength
    return scene


def create_scene(draft, denoise):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24 if draft else 48 if denoise else 72
    scene.cycles.adaptive_threshold = .044 if draft else .028
    scene.cycles.use_denoising = denoise
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = .22
    world = bpy.data.worlds.new("Cool daylight sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.48, .62, .85, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .60
    scene.world = world
    create_ground()
    create_blades(draft)
    cam = bpy.data.objects.new("Reference camera", bpy.data.cameras.new("Reference camera"))
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    sun_data = bpy.data.lights.new("Direct sun", "SUN")
    sun_data.color = (1.0, .96, .80)
    sun_data.angle = .083
    bpy.context.collection.objects.link(bpy.data.objects.new("Direct sun", sun_data))
    return scene


def main():
    args = options()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.render_only:
        scene = bpy.context.scene
    else:
        scene = create_scene(args.draft, args.denoise)
        set_view(scene, "standing", args.draft)
        if not args.draft:
            bpy.ops.wm.save_as_mainfile(filepath=str(args.out.resolve() / "fescue-sod.blend"), compress=True)
    for name in filter(None, args.views.split(",")):
        set_view(scene, name, args.draft)
        scene.render.filepath = str(args.out.resolve() / f"{name}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
