"""Build proportionally scaled catalogue previews; leave original scans untouched."""
from pathlib import Path
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
catalog_path = root / "src/data/foil-premium-catalog.json"
catalog = json.loads(catalog_path.read_text())
original_bytes = preview_bytes = 0
for item in catalog:
    for image_key, preview_key, suffix in [("image", "thumbnail", "-front"), ("backImage", "backThumbnail", "-back")]:
        source = root / "public" / item[image_key].lstrip("/")
        target = source.with_name(source.stem.replace(suffix, suffix + "-preview") + ".webp") if image_key == "backImage" else source.with_name(source.stem.replace("-front", "-preview") + ".webp")
        image = Image.open(source)
        image.thumbnail((480, 900), Image.Resampling.LANCZOS)
        image.save(target, quality=92, method=6)
        item[preview_key] = "/" + str(target.relative_to(root / "public"))
        original_bytes += source.stat().st_size
        preview_bytes += target.stat().st_size
catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
print(f"Original scans: {original_bytes:,} bytes; front/back previews: {preview_bytes:,} bytes")
