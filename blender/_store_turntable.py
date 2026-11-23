# Turntable frames for a store item's animated thumbnail (exec'd after _store_stage.py with
# TURNTABLE_NAME set). Spins the item in place under the fixed camera and lights, one full turn in
# 60 frames (5 s at 12 fps, about the gear shop's live preview speed), rendered transparent to
# art-source/store/turntable/<name>/fNNN.png. scripts/store-thumbnails.py joins them into a WebP.
import os

scene = bpy.context.scene
for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y = 480, 360
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

meshes_ = [o for o in scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in meshes_ for c in o.bound_box]
cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
pivot = bpy.data.objects.new('turntable_pivot', None)
scene.collection.objects.link(pivot)
pivot.location = (cx, cy, 0)
bpy.context.view_layer.update()
for o in meshes_:
    if o.parent is None:
        world_matrix = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_world = world_matrix

out = resolve(f'art-source/store/turntable/{TURNTABLE_NAME}')
os.makedirs(out, exist_ok=True)
FRAMES = 60
for i in range(FRAMES):
    pivot.rotation_euler.z = 2 * math.pi * i / FRAMES
    scene.render.filepath = os.path.join(out, f'f{i:03d}.png')
    bpy.ops.render.render(write_still=True)
pivot.rotation_euler.z = 0
print(f'PRINT turntable {TURNTABLE_NAME}: {FRAMES} frames -> {out}')
