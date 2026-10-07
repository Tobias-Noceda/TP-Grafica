# AGENTS.md

Guide for agents and contributors working on **Astillero orbital** (TP Computación Gráfica, 2C 2026).
The full brief is in `assignment.pdf`.

## 1. Project summary

An interactive 3D app showing a space hangar in orbit. The user configures a small spaceship from interchangeable
parts (wings, thrusters, weapons). An automated ceiling crane then picks each part up from the floor and mounts it on a
fixed fuselage. Once assembled, the ship can be viewed from the pilot seat and its landing gear can be toggled.

Two pages share the same geometry modules:

| Page            | Purpose                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `app.html`    | Main scene: hangar, platform, crane, assembly sequence, menu, 6 cameras.                                                 |
| `piezas.html` | Part viewer: pick part type and variant, toggle solid/wireframe, edit wing params, see the rebuild live. Orbital camera. |

**Hard constraints from the brief (do not violate):**

- Main parts (wings, thrusters, weapons) must be **generated procedurally at runtime**. Do not use GLTF/OBJ imports or
  externally generated static meshes. Primitives are allowed only for details, connectors, supports, crane, gear and
  other secondary elements.
- Across all variants, the parts must include at least:
  1. A **surface of revolution** whose profile visibly changes radius and curvature. A bare cylinder, cone or sphere
     does not count.
  2. A **sweep along a curved path** that visibly changes direction, with sections **oriented along the path**.
  3. A **variable-shape sweep**, where the section geometry itself changes along the path. Translating, rotating,
     twisting or uniformly scaling the section does not count.
- Profiles, paths and generating shapes must use **Three.js curves** (Bézier, Catmull-Rom, …). The curves must visibly
  shape the result.
- Every wing variant (3 of them) needs at least one **geometric parameter** that rebuilds the geometry, for example
  control points, curvature, opening angle or local thickness. Transform, global scale, material or mesh swapping do not
  count.
- Surfaces must produce correct **positions, normals and UVs**.
- The crane and the landing gear must be **hierarchical** (multi-level `Object3D` trees with visible joints).

## 2. Why Three.js

Three.js is required by the brief. It also matches the course content closely:

| Need in the project                             | What Three.js provides                                                                                                                                      | Theory source                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Hierarchical models (crane, landing gear, ship) | Scene graph:`Object3D`/`Group`. A node is a coordinate system and an edge is a relative transform. World matrix = `M_parent · M_local`.              | `transformations/arbol de la escena`                        |
| Affine transforms and composition               | `position`/`rotation`/`scale` → `obj.matrix = T·Rz·Ry·Rx·S`, `Matrix4.make*`, `matrixAutoUpdate`, Euler `rotation.order`, `Quaternion` | `transformations/transformaciones 3D`                       |
| Parametric curves                               | `CubicBezierCurve3`, `QuadraticBezierCurve3`, `CatmullRomCurve3`, `CurvePath`, 2D variants, `getPoint`/`getTangent`/`computeFrenetFrames`     | `curves/introduccion a curvas`, `curves/curvas de Bezier` |
| Custom meshes with our own normals and UVs      | `BufferGeometry` + `BufferAttribute` (`position`, `normal`, `uv`) + `setIndex`                                                                  | `geometry/geometria`                                        |
| Sweep and revolution surfaces                   | Built-ins (`LatheGeometry`, `TubeGeometry`, `ExtrudeGeometry`, `ParametricGeometry`, `ShapeGeometry`) plus room for a custom generator            | `geometry/implementacion de superficies`                    |
| Cameras, controls, lights, materials, helpers   | `PerspectiveCamera`, `OrbitControls`, `PointerLockControls`, Phong/Standard materials, `GridHelper`, `AxesHelper`                                 | `transformations/three.js - conceptos básicos`             |
| Runs in the browser with no native toolchain    | WebGL renderer, ES modules, Vite dev server                                                                                                                 | —                                                            |

**Where the built-ins fall short, and why we write our own sweep generator:**

- `LatheGeometry` builds a revolution but takes no normal function, so sharp corners in the profile get smoothed.
- `TubeGeometry` only sweeps a circle.
- `ExtrudeGeometry` is mostly suited to linear extrusion. Its `extrudePath` exists, but it cannot vary the section along
  the path.
- `ParametricGeometry` estimates normals from nearby samples, which gives one normal per vertex. Hard edges (knots)
  therefore cannot be represented.

Our generator follows the course algorithm. Each **level** (_nivel_) is a copy of the shape placed by a matrix
`M = [N B T P]`, which holds the normal, binormal and tangent vectors plus the position on the path. A triangle strip
is woven between consecutive levels. **Every level must have the same vertex count.** A surface of revolution is the
special case where the path is a circle. It should still use the curve classes for the profile.

## 3. Stack and conventions

- `three@^0.162`. Addons are imported from `three/examples/jsm/...`, for example:
  `controls/OrbitControls.js`, `controls/PointerLockControls.js`, `utils/BufferGeometryUtils.js`,
  `geometries/ParametricGeometry.js`.
- `vite@^8`, started with `npm run dev`, port **10001**. For two pages, both HTML files must be listed as build inputs in
  `vite.config.mjs` (multi-page app).
- UI: **Tweakpane** (allowed by the brief) or equivalent such as lil-gui.
- Formatting: Prettier (`.prettierrc`): **tabs** (width 4), single quotes, semicolons, `printWidth` 120, trailing
  commas `es5`.
- Coordinates: Three.js is **right-handed with Y up**. Hangar floor is `y = 0`, and the hangar's open front faces `+z`
  (keep this consistent).
- Units: 1 unit = 1 metre. Keep part sizes realistic relative to the hangar so the crane can clear them.
- Code style: ES modules, one responsibility per file, and pure geometry builders that return a `BufferGeometry` or
  `Object3D` with no scene side effects.

## 4. Suggested layout

```
app.html                 main scene entry
piezas.html              part viewer entry
public/textures/         imported PBR textures (Poly Haven, CC0) — see CREDITS.md
src/
  app/main.js            renderer, scene, post-processing (bloom), loop, keyboard (SPACE, T, C, 1-6)
  app/materials.js       texture loading + shared material library
  app/hangar.js          hangar shell, walls, ceiling, front frame, props, interior lights (HANGAR dimensions)
  app/space.js           starfield, procedural gas giant + atmosphere shaders
  app/platform.js        central assembly platform
  app/crane.js           hierarchical crane + IK-free positional API
  app/assembly.js        state machine for the pick/lift/move/lower/release sequence
  app/cameras.js         6 cameras + switching
  app/menu.js            Tweakpane UI (config, generate, pause, complete, reset, camera)
  viewer/main.js         piezas.html entry (shares src/parts/*)
  geometry/
    uv.js                world-scale box-projected UVs for tiling textures on boxes
    sweep.js             generic sweep / variable sweep / revolution generators
    frames.js            level matrices from curves (Frenet / parallel transport)
    caps.js              end caps via ShapeUtils triangulation
    curves.js            curve factories (Bézier chains, Catmull-Rom helpers)
  parts/
    fuselage.js          fixed design + cockpit + attach points
    wings.js             3 variants, each with params
    thrusters.js         2 variants (body + exhaust zone)
    weapons.js           2 variants
    landingGear.js       hierarchical, animated retract/extend
    registry.js          { type → variants → { build(params), defaults, paramSchema } }
```

`parts/registry.js` is the single source of truth. Both `app.html` and `piezas.html` read from it, as the brief
requires.

## 5. Function catalogue (needed functionality)

The signatures below are guidance. Keep the names unless there is a good reason to change them.

### 5.1 Curves (`geometry/curves.js`)

```js
// Piecewise cubic Bézier through control groups; consecutive segments share endpoints (C0).
// Align p2 of segment i, shared point, and p1 of segment i+1 on a line for C1 (tangent continuity).
bezierChain3(points /* Vector3[] length 3k+1 */) → THREE.CurvePath<Vector3>
bezierChain2(points /* Vector2[] length 3k+1 */) → THREE.CurvePath<Vector2>

catmullRom3(points, { closed = false, curveType = 'centripetal', tension = 0.5 }) → THREE.CatmullRomCurve3

// Sample a 2D shape curve uniformly in arc length → constant vertex count per level.
sampleShape(curve2D, segments) → { points: Vector2[], normals: Vector2[], u: number[] }
```

Key Three.js APIs: `getPoint(t)` / `getPointAt(u)` (arc-length), `getTangent` / `getTangentAt`, `getSpacedPoints(n)`,
`getLength()`, `computeFrenetFrames(segments, closed)`.

Bézier facts from the theory that drive design decisions:

- Degree = number of control points − 1. The curve passes through the first and last control points.
- The end tangents follow the first and last segments of the control polygon.
- Control is **global** within a segment, so use concatenated cubic segments for local control.
- The curve stays inside the convex hull of its control points, which helps when sizing collision-free parts.
- Bézier curves are affine-invariant, so it is fine to transform the control points instead of the samples.
- Catmull-Rom curves **interpolate** their points (good for paths), while Bézier curves **approximate** them (good for
  profiles).

### 5.2 Level frames (`geometry/frames.js`)

```js
// One Matrix4 per level: columns [N, B, T, P] (normal, binormal, tangent, position), last row [0 0 0 1].
levelMatrices(pathCurve, levels, { closed = false, up = new Vector3(0,1,0), method = 'frenet' | 'parallel' })
    → THREE.Matrix4[]
```

- `curve.computeFrenetFrames` is acceptable, but it flips on inflection points and straight segments. Prefer
  **parallel transport** or a fixed `up` reference for wings and paths that must not twist.
- Build each matrix with `new Matrix4().makeBasis(N, B, T).setPosition(P)`.
- To transform normals, use the rotation part only (`Matrix3().setFromMatrix4(M)`), or `getNormalMatrix(M)` when the
  section is scaled.

### 5.3 Surface generators (`geometry/sweep.js`)

```js
// Classic sweep: constant 2D shape placed at each level.
buildSweepGeometry({ shape /* Curve<Vector2> | Vector2[] */, path /* Curve<Vector3> */,
                     shapeSegments, pathSegments, closedShape = true, caps = true }) → BufferGeometry

// Variable-shape sweep: section depends on v ∈ [0,1] (required technique #3).
// shapeAt(v) MUST return the same number of sampled points for every v.
buildVariableSweepGeometry({ shapeAt /* (v) => Curve<Vector2> */, path, shapeSegments, pathSegments, caps })
    → BufferGeometry

// Surface of revolution: profile curve in XY plane revolved around Y (required technique #1).
buildRevolutionGeometry({ profile /* Curve<Vector2> */, profileSegments, radialSegments,
                          phiStart = 0, phiLength = 2π }) → BufferGeometry
```

Implementation rules:

1. **Vertices**: for each level `j` and shape sample `i`, compute `P_ij = M_j · (x_i, y_i, 0, 1)`.
2. **Indices**: for each quad between level `j` and `j+1`, emit two triangles with **counter-clockwise** winding seen
   from outside, since front faces are CCW. Check the result with `side: FrontSide` and a `VertexNormalsHelper`.
3. **Normals**: rotate the 2D shape normal by the level matrix. For sharp corners (knots), **duplicate vertices** so
   each face side keeps its own normal. This is the flat vs smooth shading point from the theory. Do not call
   `computeVertexNormals()` on sharp-edged parts.
4. **UVs**: `u` = arc-length fraction along the shape and `v` = arc-length fraction along the path. Duplicate the seam
   vertices of closed shapes (`u = 0` and `u = 1`) so textures do not smear.
5. **Caps**: triangulate the first and last levels with `THREE.ShapeUtils.triangulateShape` (handles concave shapes) or
   with a `ShapeGeometry` transformed by the level matrix. Caps need their own vertices, with normals `±T`.
6. Return an indexed `BufferGeometry` built with `setAttribute('position'|'normal'|'uv', new Float32BufferAttribute(...))`
   and `setIndex(...)`.

Allowed shortcuts: `LatheGeometry(profile.getPoints(n))` for smooth revolutions, `TubeGeometry` for circular-section
pipes, `ExtrudeGeometry` for flat plates, and `BufferGeometryUtils.mergeGeometries([...])` to fuse surfaces that share
the same attributes. The three required techniques should still go through our own generators, so we control normals
and UVs and can show the algorithm.

### 5.4 Parts (`parts/*.js`)

Each variant exports a builder with a uniform contract:

```js
export const wingVariants = {
    delta:   { label, defaults: { sweepAngle, thickness, ... }, paramSchema, build(params, material) → THREE.Group },
    curved:  { ... },
    ring:    { ... },
};
```

- `build()` returns a `Group` whose **origin is the attach point** and whose local axes match the fuselage socket.
  Mounting is then just `socket.add(part)`.
- Wings: three variants, each with ≥1 geometric param. Rebuild on change and **`geometry.dispose()` the old one**.
  The left and right wings may be mirrored copies, using `scale.x = -1` on the parent group. Flip the winding or use
  `side: DoubleSide` when mirroring.
- Thrusters: two variants, each with a clear **body** and **exhaust** zone. A revolution surface fits well here.
- Weapons: two variants, made of primitives plus curves.
- Fuselage (fixed): cockpit with windshield (transparent material), simple dashboard, `pilotCameraAnchor`
  (`Object3D`), and named sockets: `socket_wing_L/R`, `socket_thruster_L/R`, `socket_weapon_*`, `socket_gear_*`.
- Landing gear: hierarchy `strut → knee → lowerLeg → wheel`. Expose `setDeploy(t ∈ [0,1])` and animate `t` with
  easing. The `T` key toggles it.

### 5.5 Scene graph and hierarchy

- **Crane** (≥3 dependency levels): `rails (fixed) → bridge (moves along X) → trolley (moves along Z) → hoist/cable (scales/translates in Y) → gripper (claws rotate)`. Moving a parent must visibly carry its children.
- **Pick-up / drop-off** with `Object3D.attach(child)`, which reparents while keeping the world transform:
  - grab: `gripper.attach(part)`
  - release: `socket.attach(part)`, then snap `part.position.set(0,0,0); part.quaternion.identity()`
- World queries: `getWorldPosition`, `getWorldQuaternion`, `localToWorld`, `worldToLocal`, `updateMatrixWorld(true)`
  before reading.
- Use `Box3().setFromObject(obj)` to compute the safe lift height (above the fuselage and the parts already mounted).
- Manual matrices: set `obj.matrixAutoUpdate = false` and `obj.matrix.copy(m)`. Remember that `Matrix4.multiply`
  post-multiplies (`m = I·T·R·S`), so the right-most matrix is applied first.
- Rotations: Euler with an explicit `rotation.order` when it matters. Use `Quaternion.slerp` for smooth orientation
  interpolation and to avoid gimbal lock.

### 5.6 Assembly sequence (`app/assembly.js`)

A finite-state machine driven by `THREE.Clock` delta time, so it does not depend on the frame rate:

```
IDLE → MOVE_OVER_PART → LOWER → GRAB → LIFT_SAFE → MOVE_OVER_SOCKET → LOWER_TO_MOUNT → RELEASE → RETRACT → (next | DONE)
```

- `generate(config)` resets the scene, builds the fuselage on the platform, lays the parts on the floor without
  overlaps, and starts the queue.
- `pause()` / `resume()` freeze `dt` (SPACE key).
- `complete()` (optional) snaps all remaining parts to their sockets.
- `reset()` cancels the sequence and removes and **disposes** all generated parts (geometries and materials).
- Interpolate positions with `Vector3.lerpVectors` plus easing (`MathUtils.smoothstep`).

### 5.7 Cameras (`app/cameras.js`)

| Key | Camera         | Implementation hint                                                                                    |
| --- | -------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Hangar orbital | `OrbitControls`, target at the hangar centre                                                         |
| 2   | Ship orbital   | `OrbitControls`, target at the fuselage world position                                               |
| 3   | Crane follow   | Child of the trolley/gripper, or copy its world position each frame +`lookAt(gripper)`               |
| 4   | Pilot          | `PerspectiveCamera` added to `fuselage.pilotCameraAnchor`, looking at the dashboard and windshield |
| 5   | Ship chase     | Offset behind the ship in its local frame (`localToWorld`), smoothed with lerp                       |
| 6   | First person   | `PointerLockControls` + WASD, Y clamped to eye height                                                |

`C` cycles through the cameras. On resize, update the `aspect` of **every** perspective camera and call
`updateProjectionMatrix()`. Enable only the active camera's controls.

### 5.8 Hangar and environment (`app/hangar.js`, `app/space.js`)

Implemented in iteration 1. The hangar and environment are **not** ship parts, so imported textures/models are allowed
here (the procedural-only rule applies to wings, thrusters and weapons).

- Hangar: interior `HANGAR = { width: 40, depth: 48, height: 16, baySpacing: 6 }`, floor at `y = 0`, back wall at
  `z = -24`, opening at `z = +24`. Built from primitives: columns with lamp strips, catwalks, crates, X-braced back
  panels, ceiling beams, two longitudinal girders at `x = ±10` (intended as future crane rails), cyan-lit front frame.
- Textures: Poly Haven PBR sets loaded in `materials.js`. Boxes get world-scale UVs (`setBoxProjectedUVs`), so one
  material tiles consistently at its real-world `tileSize` regardless of mesh dimensions.
- Planet: `SphereGeometry` + `ShaderMaterial` with its own sun direction (so it does not light the hangar interior);
  equirectangular gas-giant texture generated on a canvas with domain-warped `ImprovedNoise` sampled on the unit
  sphere (seamless). Atmosphere: larger back-face shell, additive fresnel glow.
- Camera looking towards `+z` sees **`+x` on the left** of the screen — the planet sits at `+x` for the lower-left framing.
- Starfield: two `THREE.Points` layers on a radius-3000 sphere with `sizeAttenuation: false`.
- Lighting: `HemisphereLight` + `PointLight`s (physical units, r155+) + `RoomEnvironment` PMREM as `scene.environment`
  for metal reflections. Emissive lamp meshes + `UnrealBloomPass` give the glow; `OutputPass` applies ACES tone mapping.
  Custom `ShaderMaterial`s include `<tonemapping_fragment>` and `<colorspace_fragment>`.
- No shadows yet (materials/lighting section of the brief still to be defined).

### 5.9 Part viewer (`viewer/main.js`)

- Menu: part type → variant → params (from `paramSchema`) → solid/wireframe toggle.
- Wireframe: `material.wireframe = true`, or overlay `LineSegments(new WireframeGeometry(geo))`.
- Debug helpers: `VertexNormalsHelper` (addon), `AxesHelper`, `GridHelper`. A UV checker texture is useful for
  validating the UVs.

## 6. Theory → code map

| Theory file                                                        | Concepts to apply                                                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry/geometria.pdf`                                         | `BufferGeometry`, attributes, index buffers, CCW order, flat vs smooth normals, `side`, `wireframe`                                       |
| `geometry/implementacion de superficies.pdf`                     | Levels, level matrix`[N B T P]`, triangle strips, revolution as a sweep, built-in surface classes, `mergeGeometries`                        |
| `curves/introduccion a curvas.pdf`                               | Control points, interpolation vs approximation, local vs global control, parametric form                                                        |
| `curves/curvas de Bezier.pdf`                                    | De Casteljau, Bernstein bases, tangent = derivative, C0/C1 concatenation, discretisation                                                        |
| `transformations/transformaciones 3D.pdf`                        | T/R/S matrices, homogeneous coordinates, composition order,`matrixAutoUpdate`, Euler order, gimbal lock                                       |
| `transformations/arbol de la escena - 2 ejemplos prácticos.pdf` | Scene graph, local coordinate systems and pivots, subtrees (wheel/train/arm), kinematic chain,`clone()`, `mergeGeometries` for static parts |
| `transformations/three.js - concepto básicos.pdf`               | Renderer/Scene/Camera, Mesh = Geometry + Material, lights, perspective vs orthographic, helpers                                                 |

## 7. Pitfalls checklist

- [ ] The vertex count per level stays constant, including in variable-shape sweeps.
- [ ] Normals point outwards, and hard edges have duplicated vertices.
- [ ] Closed shapes have a duplicated seam vertex for the UVs.
- [ ] The path frames do not flip or twist unexpectedly. Check the result with `AxesHelper` at a few levels.
- [ ] Old geometries and materials are `dispose()`d on rebuild and reset.
- [ ] The pivot of each moving part is at its joint. Add an intermediate `Group` to shift the pivot if needed.
- [ ] Mirrored parts (negative scale) have the correct face winding.
- [ ] No visible intersections between the crane, the parts and the ship during transport. Use a `Box3` safe height.
- [ ] The animation uses `clock.getDelta()`. Pausing stops the assembly, but rendering and cameras keep running.
- [ ] `app.html` and `piezas.html` import the **same** `src/parts/*` builders.
