"""Render three calibrated synthetic room panoramas and a portable PALACE world fixture.
Development-only dependencies: NumPy and Pillow. Does not infer poses from photographs.
"""
import io
import json
import math
import pathlib
import zipfile
import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
CAMERAS = {'demo-a': (-2, 1.6, 2), 'demo-b': (2, 1.6, 2), 'demo-c': (0, 1.6, 0)}
W, H = 1024, 512
# Three.js SphereGeometry(-X) maps u=0 toward +X, u=.25 toward +Z,
# u=.5 toward -X and u=.75 toward -Z. The vertical center is level.
u, v = np.meshgrid((np.arange(W) + .5) / W, (np.arange(H) + .5) / H)
yaw, pitch = u * math.tau, (.5 - v) * math.pi
directions = np.stack((np.cos(yaw) * np.cos(pitch), np.sin(pitch), np.sin(yaw) * np.cos(pitch)), -1)

def render(origin):
    origin = np.asarray(origin)
    nearest = np.full((H, W), np.inf)
    rgb = np.zeros((H, W, 3), dtype=np.uint8)
    surfaces = [(0, -4, (80, 132, 174)), (0, 4, (195, 143, 96)),
                (1, 0, (122, 104, 82)), (1, 3, (216, 220, 224)),
                (2, -4, (124, 172, 148)), (2, 4, (155, 137, 175))]
    for axis, value, color in surfaces:
        with np.errstate(divide='ignore', invalid='ignore'):
            distance = (value - origin[axis]) / directions[..., axis]
        point = origin + directions * distance[..., None]
        valid = (distance > 0) & (distance < nearest)
        valid &= (point[..., 0] >= -4.001) & (point[..., 0] <= 4.001)
        valid &= (point[..., 1] >= -.001) & (point[..., 1] <= 3.001)
        valid &= (point[..., 2] >= -4.001) & (point[..., 2] <= 4.001)
        other = [i for i in range(3) if i != axis]
        checker = (np.floor(point[..., other[0]] * 2) + np.floor(point[..., other[1]] * 2)) % 2
        grid = ((point[..., other[0]] % .5) < .02) | ((point[..., other[1]] % .5) < .02)
        shade = np.where(grid, .65, np.where(checker == 0, 1, .88))
        colors = (np.asarray(color) * shade[..., None]).astype(np.uint8)
        rgb[valid] = colors[valid]
        nearest[valid] = distance[valid]
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, 'JPEG', quality=88)
    return buffer.getvalue()

def rectangle(a, b, c, d):
    return list(a + b + c + a + c + d)

geometry = []
geometry += rectangle((-4, 0, -4), (4, 0, -4), (4, 3, -4), (-4, 3, -4))
geometry += rectangle((-4, 0, 4), (4, 0, 4), (4, 3, 4), (-4, 3, 4))
geometry += rectangle((-4, 0, -4), (-4, 0, 4), (-4, 3, 4), (-4, 3, -4))
geometry += rectangle((4, 0, -4), (4, 0, 4), (4, 3, 4), (4, 3, -4))
geometry += rectangle((-4, 0, -4), (4, 0, -4), (4, 0, 4), (-4, 0, 4))
geometry += rectangle((-4, 3, -4), (4, 3, -4), (4, 3, 4), (-4, 3, 4))
plan = Image.new('RGB', (640, 640), '#eff7fa')
draw = ImageDraw.Draw(plan)
draw.rectangle((40, 40, 600, 600), outline='#527f82', width=14)
draw.text((55, 55), 'Shared World Demo: synthetic calibrated room, 8m x 8m', fill='#244a50')
plan_bytes = io.BytesIO()
plan.save(plan_bytes, 'PNG')
panoramas, registrations = {}, {}
for index, (id, position) in enumerate(CAMERAS.items()):
    panoramas[id] = {'mode': 'equirect', 'file': 'panoramas/' + id + '.jpg',
                     'room': 'Camera ' + id[-1].upper(), 'floorId': 1,
                     'planPx': {'x': 40 + (position[0] + 4) * 70, 'y': 40 + (position[2] + 4) * 70},
                     'destinations': [{'panoId': other} for other in CAMERAS if other != id]}
    registrations[id] = {'panoId': id, 'position': dict(zip(('x', 'y', 'z'), position)),
                         'rotation': {'x': 0, 'y': 0, 'z': 0, 'w': 1}, 'fov': 75}
world = {'version': 1, 'units': 'meters', 'cameras': registrations,
         'objects': {'demo-locus': {'id': 'demo-locus', 'type': 'world',
          'position': {'x': 0, 'y': 1.2, 'z': -2}, 'rotation': {'x': 0, 'y': 0, 'z': 0, 'w': 1},
          'scale': {'x': 1, 'y': 1, 'z': 1}, 'label': 'One shared locus', 'visible': True, 'interactive': True,
          'style': {'type': 'sphere', 'color': '#ff4040', 'size': .35, 'opacity': 1},
          'metadata': {'name': 'Single world-space sphere', 'syntheticPlacement': False}}},
         'geometry': {'positions': geometry, 'render': 'occlusion', 'color': '#777777'}, 'occlusion': 'geometry'}
project = {'name': 'Shared World Demo', 'kind': 'mpalace', 'levels': [
    {'name': 'Room', 'named': True, 'floorId': 1, 'w': 640, 'h': 640, 'image': 'images/plan.png',
     'markers': [], 'walls': [], 'labels': []}], 'panoramas': panoramas, 'startPano': 'demo-a',
    'worldSpace': world, 'sceneAnchors': {}, 'sceneConfigurations': {}}
output = ROOT / 'test/fixtures/shared-world-demo.mpalace'
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('palace.json', json.dumps(project, indent=2))
    archive.writestr('meta.json', json.dumps({'synthetic': True, 'generator': 'scripts/generate-world-demo.py',
                                           'description': 'Three known room capture poses; one shared entity.'}))
    archive.writestr('images/plan.png', plan_bytes.getvalue())
    for id, position in CAMERAS.items():
        archive.writestr('panoramas/' + id + '.jpg', render(position))
print(output)
