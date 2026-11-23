# Hunter's Satchel store thumbnail: a big leather backpack with side pockets, buckled flap and a
# bedroll strapped on top.
leather = mat('satchel_leather', '#7a4520', rough=0.85)
leather_dark = mat('satchel_leather_dark', '#4e2a12', rough=0.85)
flap_m = mat('satchel_flap', '#8f5428', rough=0.8)
brass = mat('satchel_brass', '#d9a63a', rough=0.35, metal=0.6)
roll = mat('satchel_bedroll', '#3f6b4a', rough=0.9)

W, D, H = 0.42, 0.24, 0.42
box('satchel_body', (W, D, H), at=(0, 0, 0), m=leather, bevel=0.04)
box('satchel_flap', (W + 0.01, 0.03, 0.2), at=(0, -D / 2 - 0.005, H - 0.19), m=flap_m, bevel=0.02)
box('satchel_flap_top', (W + 0.01, D * 0.9, 0.03), at=(0, 0, H - 0.01), m=flap_m, bevel=0.015)
for side, x in (('l', -0.11), ('r', 0.11)):
    box(f'satchel_strap_{side}', (0.035, 0.012, 0.17), at=(x, -D / 2 - 0.022, H - 0.27), m=leather_dark, bevel=0.004)
    box(f'satchel_buckle_{side}', (0.05, 0.016, 0.045), at=(x, -D / 2 - 0.028, H - 0.27), m=brass, bevel=0.005)
for side, x in (('l', -W / 2 - 0.04), ('r', W / 2 + 0.04)):
    box(f'satchel_pocket_{side}', (0.08, D * 0.75, 0.2), at=(x, 0, 0.04), m=leather_dark, bevel=0.025)
box('satchel_front_pocket', (0.26, 0.05, 0.14), at=(0, -D / 2 - 0.02, 0.04), m=leather_dark, bevel=0.02)
box('satchel_front_pocket_buckle', (0.05, 0.014, 0.04), at=(0, -D / 2 - 0.05, 0.12), m=brass, bevel=0.005)

# Bedroll across the top with two straps.
r = 0.085
c = cyl('satchel_roll', r, W + 0.1, at=(0, 0, H + r + 0.01), m=roll, seg=16, rot=(0, 90, 0), center=True)
smooth(c)
for side, x in (('l', -0.14), ('r', 0.14)):
    torus(f'satchel_roll_strap_{side}', r + 0.006, 0.012, at=(x, 0, H + r + 0.01), m=leather_dark, seg=18, minor_seg=4, rot=(0, 90, 0))
# Carry handle.
sweep('satchel_handle', [(-0.06, 0.08, H + 0.02), (-0.04, 0.09, H + 0.22), (0.04, 0.09, H + 0.22), (0.06, 0.08, H + 0.02)],
      [(0.012, 0.018)] * 4, m=leather_dark, seg=6)
