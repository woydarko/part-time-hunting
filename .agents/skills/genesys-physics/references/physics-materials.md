# Physics materials and damping

Friction and bounciness come from a `PhysicsMaterial`, a shared resource like Unity's `PhysicMaterial`. Damping is a body option. Source: `.engine/src/physics/PhysicsMaterial.ts`, `.engine/src/physics/PhysicsTypes.ts`, `.engine/src/nodes/PrimitiveNode.ts`.

## The material

| Property | Default | Meaning |
|---|---|---|
| `friction` | `0.5` | Grip, 0 or more: 0 is ice, 1 is rubber. |
| `restitution` | `0` | Bounciness, 0 or more: 1 bounces back at full speed. |
| `frictionCombine` | `Average` | How it merges with the other surface's friction. |
| `restitutionCombine` | `Average` | How it merges with the other surface's bounciness. |

`PhysicsCombineRule` is `Average`, `Min`, `Multiply` or `Max`. When two surfaces ask for different rules, the higher one in this order wins: `Max`, `Multiply`, `Min`, `Average`. With the defaults, a ball with restitution 0.9 on a plain floor (0) bounces at about half strength; `restitutionCombine: Max` on the ball makes its bounce win. `frictionCombine: Min` on an ice floor makes things slide on it, unless the other surface asks for `Multiply` or `Max`.

A node with no material uses the defaults. Built-in materials, used by path like any asset:

| Path | Values |
|---|---|
| `@engine/assets/physics/Ice.physmat.json` | friction 0.02, `Min` |
| `@engine/assets/physics/Rubber.physmat.json` | friction 1, `Max`; restitution 0.3 |
| `@engine/assets/physics/Bouncy.physmat.json` | restitution 0.9, `Max` |
| `@engine/assets/physics/Metal.physmat.json` | friction 0.3 |
| `@engine/assets/physics/Wood.physmat.json` | friction 0.6 |

## Setting it

Source: .engine/src/physics/PhysicsMaterial.ts, .engine/src/nodes/PrimitiveNode.ts
```ts
const ice = ENGINE.PhysicsMaterial.create({ friction: 0.02, frictionCombine: ENGINE.PhysicsCombineRule.Min });
const floor = ENGINE.MeshNode.create({
  geometry: new THREE.BoxGeometry(20, 1, 20), material: new THREE.MeshStandardMaterial(),
  physicsOptions: { enabled: true, physicsMaterial: ice },
});
const ball = ENGINE.MeshNode.create({
  geometry: new THREE.SphereGeometry(0.3), material: new THREE.MeshStandardMaterial(),
  position: new THREE.Vector3(0, 3, 0),
  physicsOptions: {
    enabled: true, motionType: ENGINE.PhysicsMotionType.Dynamic,
    physicsMaterial: '@engine/assets/physics/Bouncy.physmat.json',
  },
});

// During play: applies at once, keeps the body moving, no rebuild.
floor.physicsMaterial = await ENGINE.PhysicsMaterial.load('@engine/assets/physics/Rubber.physmat.json');
ice.friction = 0.1;                    // every node that uses `ice` changes
const superBall = ice.clone();         // one object's own copy
superBall.restitution = 0.95;
ball.physicsMaterial = superBall;
```

- Every node that uses one material object shares it. Change one object on its own through `clone()`.
- A path loads in the background: until it loads, the collider uses the defaults, `node.physicsMaterial` reads `null` and the world counts it as loading (`world.whenReady()` waits). For the right values from the first physics step, `await ENGINE.PhysicsMaterial.load(path)` and pass the object. Every load of a path returns the same object, until the editor drops the file from its cache.
- Saving: a material loaded from a file is saved as its path and stays shared. One made in code is saved inline: nodes saved in the same scene or prefab still share one copy after a reload, and nodes in different files each get their own. Make it a `.physmat.json` file to keep it shared.
- A child collider merged into its parent's body (`contributeToParentCollider`) keeps its own material.
- The character controller ignores friction: an ice floor does not make a player slide. Tune the movement node instead (`genesys-movement`). Raw `createPhysicsBody` bodies take no material.

## In the editor

- Create one with **New Resource → PhysicsMaterial**; it saves as `Name.physmat.json`. Select the file to edit its four values.
- On a node, **Physics Options → Physics Material** is a picker that lists only physics materials. The built-ins show when **Engine Assets** is ticked in the picker. None clears it.
- An edit in the inspector applies to every node that uses the file at once, without a reload.
- When the editor drops the file from its cache (after a script build, or a file changed outside the editor), nodes that use it by path load the new contents and apply them without a rebuild.
- A material set in code shows as **Inline (set in code)**; picking a file replaces it.

## Damping

`physicsOptions.linearDamping` and `angularDamping` (0 or more, default 0) slow a body's movement and spin by themselves: drag, water, a sticky prop. They apply to the body's owner node, survive a rebuild, and a change with `overridePhysicsOptions` applies without a rebuild. `setScalarParam(PhysicsScalarParam.LinearDamping, v)` writes only the live body: a rebuild (physics switched off and on, a geometry or motion change) or any change to the node's physics material (a swap, an edit of the shared material, a reload of its file) puts the option's value back; a scale rebuild keeps it.
