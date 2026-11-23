# Merchant's Charm store thumbnail: a gold medallion with a balance-scale emblem and a green gem,
# hung on a braided leather cord, with a few gold sparkles.
gold = mat('charm_gold', '#f5c542', rough=0.35, metal=0.15)
gold_dark = mat('charm_gold_dark', '#b8801a', rough=0.4, metal=0.15)
gem = mat('charm_gem', '#2fc46a', rough=0.1, emit='#2fc46a', emit_strength=1.2)
cord = mat('charm_cord', '#5a3418', rough=0.85)
spark = mat('charm_spark', '#ffe08a', rough=0.5, emit='#ffd15a', emit_strength=4.0)

Z = 0.25  # medallion centre height; it stands facing the camera (-Y)
cyl('charm_disc', 0.15, 0.03, at=(0, 0, Z), m=gold, seg=28, rot=(90, 0, 0), center=True)
torus('charm_rim', 0.15, 0.016, at=(0, 0, Z), m=gold_dark, seg=28, minor_seg=6, rot=(90, 0, 0))
torus('charm_bail', 0.03, 0.009, at=(0, 0, Z + 0.17), m=gold_dark, seg=14, minor_seg=5, rot=(0, 90, 0))

# Balance scale emblem on the front face (front is -Y).
F = -0.018
rod('charm_scale_post', (0, F, Z - 0.09), (0, F, Z + 0.07), 0.008, m=gold_dark)
rod('charm_scale_beam', (-0.085, F, Z + 0.06), (0.085, F, Z + 0.06), 0.007, m=gold_dark)
for side, x in (('l', -0.075), ('r', 0.075)):
    rod(f'charm_scale_string_{side}', (x, F, Z + 0.06), (x, F, Z - 0.01), 0.003, m=gold_dark)
    cyl(f'charm_scale_pan_{side}', 0.032, 0.012, at=(x, F, Z - 0.02), m=gold_dark, seg=12, r2=0.018, center=True, rot=(180, 0, 0))
box('charm_scale_base', (0.07, 0.012, 0.015), at=(0, F, Z - 0.1), m=gold_dark, bevel=0.003)
ico('charm_gem', 0.03, at=(0, F - 0.012, Z + 0.075), m=gem, subdiv=1, scale=(1, 0.6, 1))

# Cord: a V going up from the bail.
sweep('charm_cord_l', [(0, 0, Z + 0.19), (-0.06, 0.01, Z + 0.3), (-0.12, 0.02, Z + 0.42)], [(0.009, 0.009)] * 3, m=cord, seg=6)
sweep('charm_cord_r', [(0, 0, Z + 0.19), (0.06, 0.01, Z + 0.3), (0.12, 0.02, Z + 0.42)], [(0.009, 0.009)] * 3, m=cord, seg=6)

for i, at in enumerate(((-0.2, -0.05, Z + 0.12), (0.21, -0.04, Z - 0.05), (0.17, -0.06, Z + 0.17), (-0.16, -0.06, Z - 0.14))):
    ico(f'charm_spark_{i}', 0.012 if i % 2 else 0.018, at=at, m=spark, subdiv=1, scale=(1, 1, 2.2))
