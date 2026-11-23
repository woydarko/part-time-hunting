# Field Potion Kit store thumbnail: an open wooden kit box holding 2 green, 1 blue and 1 red potion.
wood = mat('kit_wood', '#8a5a2e', rough=0.8)
wood_dark = mat('kit_wood_dark', '#5e3a1a', rough=0.85)
brass = mat('kit_brass', '#d9a63a', rough=0.35, metal=0.6)
glass = mat('kit_glass', '#d8ecff', rough=0.05, alpha=0.18)
cork = mat('kit_cork', '#a87a4a', rough=0.8)
liquids = {
    'green': mat('kit_liquid_green', '#3fc24a', rough=0.2, emit='#3fc24a', emit_strength=2.0),
    'blue': mat('kit_liquid_blue', '#3a7cf0', rough=0.2, emit='#3a7cf0', emit_strength=2.0),
    'red': mat('kit_liquid_red', '#e0303a', rough=0.2, emit='#e0303a', emit_strength=2.0),
}

# Box: floor, four walls and brass corners.
W, D, H, T = 0.56, 0.2, 0.12, 0.02
box('kit_floor', (W, D, T), at=(0, 0, 0), m=wood, bevel=0.006)
box('kit_front', (W, T, H), at=(0, -D / 2 + T / 2, 0), m=wood, bevel=0.006)
box('kit_back', (W, T, H), at=(0, D / 2 - T / 2, 0), m=wood, bevel=0.006)
box('kit_left', (T, D, H), at=(-W / 2 + T / 2, 0, 0), m=wood_dark, bevel=0.006)
box('kit_right', (T, D, H), at=(W / 2 - T / 2, 0, 0), m=wood_dark, bevel=0.006)
for i, x in enumerate((-W / 2, W / 2)):
    for j, y in enumerate((-D / 2, D / 2)):
        box(f'kit_corner_{i}{j}', (0.035, 0.035, 0.035), at=(x, y, H - 0.03), m=brass, bevel=0.005)


def flask(name, x, liquid, r=0.07):
    """A round potion flask standing in the box at x."""
    f = sphere(f'{name}_flask', r, at=(x, 0, T + r), m=glass, seg=16, rings=10)
    smooth(f)
    l = sphere(f'{name}_liquid', r * 0.88, at=(x, 0, T + r * 0.95), m=liquids[liquid], seg=16, rings=10, scale=(1, 1, 0.85))
    smooth(l)
    cyl(f'{name}_neck', r * 0.35, r * 0.9, at=(x, 0, T + r * 1.8), m=glass, seg=12)
    cyl(f'{name}_cork', r * 0.4, r * 0.45, at=(x, 0, T + r * 2.6), m=cork, seg=10, r2=r * 0.45)


for i, (liquid, x) in enumerate((('green', -0.195), ('green', -0.065), ('blue', 0.065), ('red', 0.195))):
    flask(f'kit_potion_{i}', x, liquid)
