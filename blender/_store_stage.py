# Shared staging for the Silicon store thumbnails (exec'd as the last step of each blender/store-* folder).
# Frames every mesh in the scene from a front 3/4 view for the store's 4:3 tile, warm key + rim light,
# transparent background so the tile's own leather gradient shows behind the item.
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2
size = max(hi - lo)
view = Vector((0.45, -1.0, 0.42)).normalized()
camera('store_cam', tuple(centre + view * size * 2.45), look_at=tuple(centre), lens=50)
k = (size / 0.5) ** 2
point_light('key', tuple(centre + Vector((size * 0.8, -size * 1.3, size * 1.2))), power=60 * k, color='#fff1dc', radius=size * 0.5)
point_light('fill', tuple(centre + Vector((-size * 1.4, -size * 0.8, size * 0.3))), power=14 * k, color='#ffd9a8', radius=size * 0.6)
point_light('rim', tuple(centre + Vector((-size * 0.5, size * 1.2, size * 1.0))), power=70 * k, color='#ffc27a', radius=size * 0.4)
world('#ffe9c2', 0.18)
