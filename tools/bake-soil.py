"""Bake Hellesylt parent-material codes and compact Ground103 CC0 surface maps.

Usage: python3 tools/bake-soil.py Ground103_1K-JPG.zip assets/soil
Requires GDAL command-line tools and Pillow. Network is only used at bake time.
"""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

from PIL import Image

GEOCENTRE = (388754, 6885254)
EXTENT = 2048
CELL = 16
NGU = "https://geo.ngu.no/api/features/losmasseregionalt/collections/losmasseflate/items"
NGU_REGISTRY = "https://data.norge.no/en/datasets/4c8bdb99-68e3-317c-922f-a77d1f21e309/losmasser-regionalt"
NGU_LICENSE = "https://data.norge.no/nlod/en/1.0"
SCAN = "https://ambientcg.com/view?id=Ground103"


def bake_geology(output):
    x, y = GEOCENTRE
    bounds = x - EXTENT, y - EXTENT, x + EXTENT, y + EXTENT
    corners = "".join(f"{a} {b}\n" for a in bounds[::2] for b in bounds[1::2])
    transformed = subprocess.run(
        ["gdaltransform", "-s_srs", "EPSG:25832", "-t_srs", "EPSG:4326"],
        input=corners, text=True, capture_output=True, check=True,
    )
    lons, lats = zip(*(map(float, line.split()[:2]) for line in transformed.stdout.splitlines()))
    bbox = (min(lons), min(lats), max(lons), max(lats))
    url = NGU + "?" + urllib.parse.urlencode({"f": "json", "limit": 1000, "bbox": ",".join(map(str, bbox))})
    with urllib.request.urlopen(url, timeout=30) as response:
        data = json.load(response)
    if not data.get("features") or data.get("numberMatched", 0) > len(data["features"]):
        raise ValueError("Regional geology incomplete")
    codes = set()
    for feature in data["features"]:
        code = int(feature["properties"]["løsmassetype"])
        if not 1 <= code <= 255:
            raise ValueError(f"Unexpected parent-material code {code}")
        feature["properties"] = {"parent": code}
        codes.add(code)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)
        source = path / "source.geojson"
        source.write_text(json.dumps(data))
        projected = path / "utm.geojson"
        subprocess.run(["ogr2ogr", "-t_srs", "EPSG:25832", str(projected), str(source)], check=True)
        raster = path / "soil.tif"
        subprocess.run(["gdal_rasterize", "-q", "-a", "parent", "-ot", "Byte", "-init", "0",
                        "-te", *map(str, bounds), "-tr", str(CELL), str(CELL), str(projected), str(raster)], check=True)
        with Image.open(raster) as img:
            (output / "hellesylt-parent.bin").write_bytes(img.tobytes())
    return {
        "source": url, "registry": NGU_REGISTRY, "attribution": "© Norges geologiske undersøkelse (NGU)",
        "license": "NLOD 1.0", "license_url": NGU_LICENSE, "changes": "Clipped to Hellesylt and rasterized in UTM.",
        "codes": sorted(codes), "crs": "EPSG:25832", "utm_bounds": bounds, "cell_m": CELL,
    }


def bake_scan(archive, output):
    with zipfile.ZipFile(archive) as source:
        def channel(name, mode):
            image = Image.open(io.BytesIO(source.read(f"Ground103_1K-JPG_{name}.jpg")))
            return image.convert(mode).resize((512, 512), Image.Resampling.LANCZOS)

        color = channel("Color", "RGB")
        Image.merge("RGBA", (*color.split(), channel("Roughness", "L"))).save(output / "soil-albedo-roughness.png")
        normal = channel("NormalGL", "RGB")
        Image.merge("RGBA", (*normal.split(), channel("Displacement", "L"))).save(output / "soil-normal-height.png")


if __name__ == "__main__":
    archive, destination = map(Path, sys.argv[1:])
    destination.mkdir(parents=True, exist_ok=True)
    metadata = bake_geology(destination)
    bake_scan(archive, destination)
    (destination / "sources.json").write_text(json.dumps({
        "geology": metadata, "scan": {"source": SCAN, "license": "CC0-1.0", "size_px": 512,
                                      "world_repeat_m": 1.2, "scale": "visual calibration"}
    }, indent=2, ensure_ascii=False) + "\n")
