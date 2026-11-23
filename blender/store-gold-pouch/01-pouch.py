# Gold Pouch store thumbnail: a plump leather drawstring pouch with gold coins spilling out.
leather = mat('pouch_leather', '#7a4520', rough=0.85)
cord = mat('pouch_cord', '#d8b878', rough=0.8)
gold = mat('pouch_gold', '#f5c542', rough=0.35, metal=0.15)
gold_dark = mat('pouch_gold_rim', '#d99a22', rough=0.4, metal=0.15)

sack = blob('pouch_sack', 0.17, at=(0, 0, 0.15), m=leather, scale=(1.0, 0.95, 0.88), lumpy=0.05)
smooth(sack)
lathe('pouch_neck', [(0.07, 0.27), (0.05, 0.31), (0.075, 0.35), (0.11, 0.39), (0.0, 0.37)], m=leather, seg=16)
torus('pouch_tie', 0.055, 0.012, at=(0, 0, 0.305), m=cord, seg=16, minor_seg=6)
sweep('pouch_tie_end', [(0.05, -0.02, 0.3), (0.09, -0.06, 0.24), (0.1, -0.08, 0.17)], [(0.01, 0.01)] * 3, m=cord, seg=6)

seed(3)


def coin(name, at, tilt=(0, 0, 0)):
    """One gold coin (rim + face) at its centre."""
    cyl(f'{name}', 0.04, 0.012, at=at, m=gold, seg=16, rot=tilt, center=True)
    torus(f'{name}_rim', 0.04, 0.005, at=at, m=gold_dark, seg=16, minor_seg=4, rot=tilt)


# Coins heaped in the open mouth and spilled in front.
for i in range(5):
    coin(f'coin_top_{i}', (rnd(-0.05, 0.05), rnd(-0.04, 0.04), 0.375 + i * 0.006), (rnd(-25, 25), rnd(-25, 25), 0))
spill = [(-0.13, -0.13, 0.006), (-0.02, -0.16, 0.006), (0.1, -0.14, 0.006), (0.04, -0.15, 0.018)]
for i, at in enumerate(spill):
    coin(f'coin_spill_{i}', at, (rnd(-8, 8), rnd(-8, 8), 0))
coin('coin_lean', (0.19, -0.08, 0.05), (70, 0, 30))
