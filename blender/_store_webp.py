"""Join a store item's turntable frames into a looping animated WebP for its store thumbnail.

Usage (project root, system Python with Pillow): python -I blender/_store_webp.py quiver [potion-kit ...]
Reads art-source/store/turntable/<name>/f*.png (from blender/store-<name>, step 03-turntable.py) and
writes art-source/store/<name>.webp: 12 fps, endless loop, transparent background.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAME_MS = 83  # 12 fps: one turn of 60 frames in 5 s, about the gear shop's live preview speed

for name in sys.argv[1:]:
    frames = [Image.open(p).convert('RGBA') for p in sorted((ROOT / 'art-source/store/turntable' / name).glob('f*.png'))]
    if not frames:
        sys.exit(f'no frames for {name}: build blender/store-{name} first')
    out = ROOT / 'art-source/store' / f'{name}.webp'
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0, quality=80, method=6)
    print(f'{out.relative_to(ROOT)}  {len(frames)} frames  {out.stat().st_size // 1024} KB')
