# Hunter's Quiver store thumbnail: tilted leather quiver, brass bands, shoulder strap, a bundle of fletched arrows.
from mathutils import Matrix

leather = mat('quiver_leather', '#7a3f1c', rough=0.8)
strap = mat('quiver_strap', '#4a2a12', rough=0.85)
brass = mat('quiver_brass', '#d9a63a', rough=0.35, metal=0.6)
inside = mat('quiver_inside', '#2a160a', rough=0.9)
shaft = mat('arrow_shaft', '#b98a52', rough=0.7)
red = mat('arrow_fletch_red', '#b8281e', rough=0.7)
white = mat('arrow_fletch_white', '#e6dcc4', rough=0.7)

body = cyl('quiver_body', 0.09, 0.44, at=(0, 0, 0), m=leather, seg=18, r2=0.105)
smooth(body)
cyl('quiver_mouth', 0.098, 0.004, at=(0, 0, 0.44), m=inside, seg=18)
torus('quiver_band_low', 0.095, 0.013, at=(0, 0, 0.06), m=brass, seg=20, minor_seg=6)
torus('quiver_band_high', 0.107, 0.014, at=(0, 0, 0.425), m=brass, seg=20, minor_seg=6)
# Shoulder strap: from the bottom band, up behind the quiver and over the top.
sweep('quiver_strap', [(0.09, 0.03, 0.07), (0.17, 0.08, 0.3), (0.13, 0.1, 0.55), (0.0, 0.11, 0.66), (-0.1, 0.06, 0.45)],
      [(0.014, 0.022)] * 5, m=strap, seg=6)
box('quiver_buckle', (0.04, 0.04, 0.04), at=(0.16, 0.07, 0.25), m=brass, bevel=0.006)

seed(7)
spots = [(0, 0), (0.045, 0.02), (-0.045, 0.015), (0.02, -0.045), (-0.025, -0.04), (0.05, -0.03), (-0.05, -0.02)]
for i, (x, y) in enumerate(spots):
    top = (x * 2.2, y * 2.2, 0.68 + rnd(-0.03, 0.03))
    rod(f'arrow_{i}', (x, y, 0.3), top, 0.008, m=shaft, seg=6)
    cyl(f'arrow_fletch_{i}', 0.026, 0.09, at=(top[0], top[1], top[2] - 0.095), m=red if i % 2 == 0 else white,
        seg=3, r2=0.012, rot=(0, 0, rnd(0, 120)))

# Lean the whole quiver so it reads as a quiver, not a mug.
tilt = Matrix.Rotation(math.radians(-16), 4, 'Y')
for o in bpy.context.scene.objects:
    o.matrix_world = tilt @ o.matrix_world
