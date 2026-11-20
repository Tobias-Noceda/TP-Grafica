# AGENTS.md

Guide for agents and contributors working on **Astillero orbital** (TP Computación Gráfica, 2C 2026).
The full brief is in `assignment.pdf`. Design decisions and the **register of where each required surface technique is
used** are in `DECISIONS.md`. Read it before touching a part, and update it whenever a part adds, changes or removes a
revolution, curved-path sweep or variable-shape sweep.

## 1. Project summary

An interactive 3D app showing a space hangar in orbit. The user configures a small spaceship from interchangeable
parts (wings, thrusters, weapons). An automated ceiling crane then picks each part up from the floor and mounts it on a
fixed fuselage. Once assembled, the ship can be viewed from the pilot seat and its landing gear can be toggled.

Two pages share the same geometry modules:

| Page          | Purpose                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `app.html`    | Main scene: hangar, platform, crane, assembly sequence, menu, 7 cameras.                                                 |
| `piezas.html` | Part viewer: pick part type and variant, toggle solid/wireframe, edit wing params, see the rebuild live. Orbital camera. |

**Hard constraints from the brief (do not violate):**

- Main parts (wings, thrusters, weapons) must be **generated procedurally at runtime**. Do not use GLTF/OBJ imports or
  externally generated static meshes. Primitives are allowed only for details, connectors, supports, crane, gear and
  other secondary elements.
- Across all variants, the parts must include at least the following. **One use of each across the whole ship is
  enough.** Not every piece needs every technique: a piece's look comes first, and it uses the technique that fits it
  naturally (see `DECISIONS.md` §1):
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

| Need in the project                             | What Three.js provides                                                                                                                    | Theory source                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Hierarchical models (crane, landing gear, ship) | Scene graph:`Object3D`/`Group`. A node is a coordinate system and an edge is a relative transform. World matrix = `M_parent · M_local`.   | `transformations/arbol de la escena`                      |
| Affine transforms and composition               | `position`/`rotation`/`scale` → `obj.matrix = T·Rz·Ry·Rx·S`, `Matrix4.make*`, `matrixAutoUpdate`, Euler `rotation.order`, `Quaternion`    | `transformations/transformaciones 3D`                     |
| Parametric curves                               | `CubicBezierCurve3`, `QuadraticBezierCurve3`, `CatmullRomCurve3`, `CurvePath`, 2D variants, `getPoint`/`getTangent`/`computeFrenetFrames` | `curves/introduccion a curvas`, `curves/curvas de Bezier` |
| Custom meshes with our own normals and UVs      | `BufferGeometry` + `BufferAttribute` (`position`, `normal`, `uv`) + `setIndex`                                                            | `geometry/geometria`                                      |
| Sweep and revolution surfaces                   | Built-ins (`LatheGeometry`, `TubeGeometry`, `ExtrudeGeometry`, `ParametricGeometry`, `ShapeGeometry`) plus room for a custom generator    | `geometry/implementacion de superficies`                  |
| Cameras, controls, lights, materials, helpers   | `PerspectiveCamera`, `OrbitControls`, `PointerLockControls`, Phong/Standard materials, `GridHelper`, `AxesHelper`                         | `transformations/three.js - conceptos básicos`            |
| Runs in the browser with no native toolchain    | WebGL renderer, ES modules, Vite dev server                                                                                               | —                                                         |

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
  app/main.js            renderer, scene, post-processing (bloom), loop, keyboard (SPACE pause, P fire, T, O, C, 1-7, arrows → crane); app modes (preview / assembling / flight), Generate/Complete/Reset, sim dt × speed
  app/materials.js       texture loading + shared material library (hangar + ship materials)
  hangar/hangar.js       hangar shell, walls, ceiling, front frame, props, interior lights (HANGAR dimensions)
  hangar/platform.js     central assembly platform (PLATFORM dimensions, mountPoint on the deck)
  scene/space.js         starfield, procedural gas giant + atmosphere shaders
  app/crane.js           hierarchical underhung crane: bridge, trolley, hoist drum, swinging cable, magnet tip; manual
                         (arrows, horizontal only) and automatic drive (moveTo, precision, swing lock)
  app/assembly.js        state machine for the pick/lift/move/lower/insert/release sequence (§5.6)
  app/cameras.js         7 cameras + switching
  app/menu.js            Tweakpane UI, top-right: View, Assembly (Generate, Pause, Complete, Reset, speed, status,
                         pieces preview), Wings, Weapons, Thrusters (hidden while assembling)
  app/loadout.js         wings + which part kind sits on which hardpoint (incl. the wing one); equip/unequip, disposal; pieces() in assembly order, mountPiece/detachPiece
  app/layout.js          floor layout: each piece at its mounted world pose translated (wings beside the platform on pads/jig,
                         weapons rack front-right, thrusters rack front-left), stands, grip point for the magnet
  viewer/main.js         piezas.html entry (shares src/parts/*)
  geometry/
    uv.js                world-scale box-projected UVs for tiling textures on boxes
    sweep.js             revolution + variable-shape sweep (implemented); constant sweep to add when needed
    frames.js            level matrices from curves ('up' / parallel transport) (implemented)
    caps.js              end caps via ShapeUtils triangulation
    curves.js            bezierChain2, sampleShape (implemented); more factories as needed
  parts/
    fuselage.js          fixed X-wing style design (primitives only) + cockpit + pilot + sockets + 3 gears (tricycle)
    wings.js             wingVariants map only (3 variants, each with params)
    wings/               one file per variant: xWingSFoils.js (primitive S-foils), planeWing.js (variable sweep),
                         tieInterceptor.js (variable sweep: hull rectangle → wing outline),
                         common.js (root chord, fairing, top hardpoint shared by the wings)
    thrusters.js         thrusterVariants map only (2 variants, body + exhaust zone)
    propulsors/          one file per thruster variant: rearEngine.js (revolution; rear, top, wing), quadBlock.js (2×2 variable-sweep block, rear-only),
                         common.js (engine nacelle, radialRing)
    weapons.js           weaponVariants map only (2 variants)
    weapons/             one file per weapon variant: machineGun.js (revolution barrel), minigun.js (revolution
                         barrels + housing, curved-sweep feed chute, wing/top only), common.js (pylon, helpers)
    landingGear.js       hierarchical (strut → knee → lowerLeg → wheel), setDeploy(t)
    sockets.js           shared mountPart / unmountPart / buildPadCover
    registry.js          { type → variants → { build(params), defaults, paramSchema } }
```

Status: `hangar/`, `scene/`, `app/main.js`, `app/materials.js`, `app/loadout.js`, `app/menu.js` (view, wings, weapons, thrusters),
`app/cameras.js` (7 cameras), `app/shadows.js` (spot + contact shadow), `app/crane.js` (manual + automatic drive, hoist),
`app/layout.js` (floor layout), `app/assembly.js` (assembly sequence),
`geometry/uv.js`, `geometry/curves.js`, `geometry/frames.js`, `geometry/sweep.js` (revolution + variable sweep),
`parts/fuselage.js`, `parts/landingGear.js`, `parts/sockets.js`, `parts/propulsors/` (rearEngine, quadBlock),
`parts/weapons/` (machineGun, minigun), `parts/wings/` (xwing, plane, tie) with their maps and `viewer/main.js` (gallery) exist. The rest (caps module, constant sweep, registry) is still to be written.

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

Each kind has a map file (`wings.js`, `weapons.js`, `thrusters.js`) that only lists its variants by id, and one file
per variant in its folder (`wings/`, `weapons/`, `propulsors/`), named after the variant and exporting its variant
object. Shared code for one kind goes in that folder's `common.js`. Variant files use their own `defaults`, never the
map (no circular imports). See D-020.

Each variant exports a builder with a uniform contract:

```js
// parts/wings/planeWing.js
export const planeWing = { label, opens, defaults: { span, tipChord, ... }, paramSchema, build(params, materials) → THREE.Group };

// parts/wings.js
export const wingVariants = { xwing: xWingSFoils, plane: planeWing, tie: tieInterceptor };
```

- `build()` returns a `Group` whose **origin is the attach point** and whose local axes match the fuselage socket.
  Mounting is then just `socket.add(part)`.
- Wings: three variants, each with ≥1 geometric param. Rebuild on change and **`geometry.dispose()` the old one**.
  Variants declare `opens` (whether they expose `userData.setOpen(t)`) and expose `userData.sockets.top`, a hardpoint
  on the panel near the root (child of the panel/hinge, `side: 'L'` because the wing is already mirrored).
  `xwing` (default, implemented): per side an upper and a lower squared panel (variable-shape sweep of a tapering
  `roundedRectangle` along a straight path, `buildPanelGeometries`) on hinges rotating about z (fairing + chrome pins); param `span`; opens into an X with the `O` key (starts
  closed). `plane` (implemented): one fixed panel per side, a variable-shape sweep of a Bézier airfoil along a Bézier
  span path; params `span`, `tipChord`, `sweep`, `rootThickness`. `tie` (implemented, TIE Interceptor inspired, static):
  the whole wing is one variable-shape sweep whose section goes from a rectangle flush on the hull to the full wing
  outline (half-octagon back extended forward into two daggers); hardpoint on top of the neck; params `pylonLength`, `span`,
  `tipReach`, `rearDepth` (D-021).
  The left and right wings may be mirrored copies, using `scale.x = -1` on the parent group. Flip the winding or use
  `side: DoubleSide` when mirroring.
- Thrusters: two variants, each with a clear **body** and **exhaust** zone. `build(params, materials, { outward })`
  points the nozzle along `outward`. A variant may declare `hardpoints` (ids it is allowed on);
  `hardpointsFor(kind, variantId)` and `loadout.equip` honour it. `rearEngine` (implemented, label "Engine", `hardpoints: ['rear', 'top', 'wing']`): one large X-wing style engine filling the tail,
  short (default 0.9 m) so it barely protrudes, built around its local `+y` in a `nacelle` group (`buildEngineNacelle` in `propulsors/common.js`). Body: adapter plate,
  intake ring with ribbed teeth, casing with a groove and a raised red stripe. Exhaust: slatted collar, converging
  nozzle with a thick lip, a petal cone converging to a small emissive core (`materials.exhaust`) with fan blades and a
  hub. Casing, nozzle, cone, core and hub are Bézier-profile revolutions split into runs by material (`profileRuns`);
  params `length`, `nozzleFlare`. Teeth, slats, petals and blades are merged boxes (`radialRing`). On top and wing hardpoints the same engine lies on holders, nozzle backwards, with a nose
  cone: one full-size engine shared by the top pair (built by the left socket at `toPairCentre`), and a smaller one
  per wing (`WING_SCALE` 0.45, fits every wing incl. the TIE neck; D-023). The menu hides positions taken by the
  other part kind.
  `quadBlock` (implemented, `hardpoints: ['rear']`): 2×2 square engines in a dark frame; each cell is a variable-shape
  sweep of `roundedRectangle` (intake → casing → nozzle morphing square → round), revolution throat and glowing core;
  params `length`, `roundness`, `nozzleFlare`, `gap` (D-023).
- Weapons: two variants, made of primitives plus curves. `build(params, materials, { outward, clearance })`: they always fire
  along `+z` with `+y` up, and `outward` (the socket's hull normal) only sets which way the pylon grows (`clearance`, optional per socket, sets its length), so one weapon
  fits side and top hardpoints. They are built for the left side and mirrored with `scale.x = -1` for the right. `machineGun` (implemented) has a Bézier-profile revolution barrel
  with params `barrelLength` and `muzzleFlare`, and a receiver, rail, sights, fins and magazine made of primitives. `minigun` (implemented, `hardpoints: ['wing', 'top']`,
  D-022): `barrelCount` 5–8 barrels (shared Bézier revolution) in a `rotor` group with clamp rings, a revolution motor
  housing, and an ammo feed chute swept along a curved path into the hull; params `barrelCount`, `barrelLength`.
  Both guns expose `userData.fire()` / `userData.update(dt)` and a `userData.muzzle` node: `fire()` shows a muzzle
  spark (`addMuzzleFlash` in `weapons/common.js`, additive primitives, fades in 0.1 s), and on the minigun also queues
  a one-barrel turn (`2π / n`); its `muzzle` stays at the firing (top) barrel. Fired with `P` in flight mode only (held: one shot per 0.15 s)
  (D-029). Like thrusters, a weapon variant may declare `hardpoints`.
- Fuselage (fixed, implemented): X-wing inspired, built **only from primitives**, with no curves or sweeps. The main
  pieces are `taperedBox`es, which are `BoxGeometry`s with their corners moved so every face stays planar with flat
  normals. Nose points to `+z`, up `+y`, pilot's left `+x`. `FUSELAGE` holds the key z stations and the belly
  `clearance` (1.2 m). It is made of a tapered tail, a rectangular rear body (`BODY` section), a wedge nose with red
  stripes and a sensor probe, a faceted glass canopy (two tapered boxes) with frame hoop, a seat and a tilted dashboard
  with emissive screens, and a seated pilot (orange suit, white helmet) sunk into the cockpit tub so the helmet
  clears the canopy. The group origin is the ground contact point
  between the gears, so it is added straight to `platform.userData.mountPoint`. `userData` holds
  `pilotCameraAnchor` (already yawed to face `+z`), `sockets` (by name), `setGearDeploy(t)` and
  `mountPart(name, part)` / `unmountPart(name)` (mirrors parts on `R` sockets). Sockets live in the `body` group
  and keep the ship orientation: `socket_wing_L/R`, hardpoint pairs `socket_nose_L/R`, `socket_top_L/R` and
  `socket_tail_L/R`, the centre `socket_rear` (side `C`, never mirrored), and `socket_gear_front` / `socket_gear_back_L/R`. **Hardpoints** (exported `HARDPOINTS`) are positions, not part
  types: each lists the kinds it `accepts` (nose: weapon, top: weapon + thruster, tail and rear: thruster; wing
  hardpoints come from wing parts), and holds one kind at a time. `tail` and `rear` share the tail plate and list each
  other in `overlaps`, so only one of them can be used; the `socket_rear` cover is a group holding both tail covers. Part sockets store `side`, `outward` (left-side frame) and a
  cover (sibling in `body`, `socket.userData.cover`): hull-paint hatches with a dark seam and bolts on the sides and tail, round red-ringed pads
  on the top fairing. `mountPart` hides the cover and `unmountPart` shows it again.
- Landing gear (implemented): tricycle, a centred nose gear (`z = 2.6`) and two main gears (`x = ±0.45`, `z = -2.6`),
  each with twin wheels (D-024). Hierarchy is
  `root (socket) → strut → knee → lowerLeg → wheel`, with chrome joint pins on every pivot.
  `buildLandingGear(materials, { height, foldDirection })` sizes the legs so the wheels touch `y = -height` when
  deployed. `setDeploy(t ∈ [0,1])` rotates the strut and knee. `main.js` animates `t` with `smoothstep` over 2 s, and
  the `T` key toggles it.

### 5.5 Scene graph and hierarchy

- **Crane** (implemented, D-026, ≥3 dependency levels): `runway rails (fixed, under the girders at x = ±15) → bridge
(moves along Z) → trolley (moves along X) → hoist drum (rotates as cable pays out) → swing (pivot at the drum, pendulum sway) →
cable (variable length, `HOIST` 1.5–10.9 m) + magnet → attachPoint / cameraMount`. Underhung: it hangs below the
  girders; the magnet face reaches y = 0.2–9.6 (`CRANE_LIMITS.y`).
  Arrow keys drive it horizontally only (←/→ = ±x, ↑/↓ = ±z) through `crane.userData.setInput({ x, z })`;
  the hoist (1.2 m/s) is never driven manually, only by the assembly through `moveTo`; `update(dt)` ramps the speed
  (1.5 m/s², max 3.5 m/s trolley / 4 m/s bridge), brakes before the end stops (`CRANE_LIMITS`) and integrates a near-critically damped (anti-sway) pendulum per
  axis from the carriage acceleration. The tip is an **electromagnet**, not a claw: no claw joints to animate;
  `setMagnet(on)` lights its ring. Moving a parent must visibly carry its children.
  Automatic drive (for the assembly): `setAuto(on)` (manual input ignored, critical anti-sway damping for the live
  cable length), `moveTo({ x, z, y })` (y = magnet-face world height; position control with a √ braking profile at
  0.45·a and a linear last 5 cm, so no overshoot), `arrived()`, `settled(tolDeg)`, `faceWorldPosition()`,
  `cableLength()`. Long moves take ~7–9 s at ×1 and the sway settles 1–4 s later, leaving ≤ 5 cm of offset at
  0.2°. Precision placement: `setPrecision(on)` (35 % speed and acceleration) and `setSwingLock(on)` (sway no
  longer driven, decays at 6 /s, like a rigger's guide lines).
- **Pick-up / drop-off** with `Object3D.attach(child)`, which reparents while keeping the world transform:
    - grab: `crane.userData.attachPoint.attach(part)` (magnet face)
    - release: `loadout.mountPiece(piece)` (socket.add + the recorded mount-local transform, cover hidden)
- World queries: `getWorldPosition`, `getWorldQuaternion`, `localToWorld`, `worldToLocal`, `updateMatrixWorld(true)`
  before reading.
- Use `Box3().setFromObject(obj)` to compute the safe lift height (above the fuselage and the parts already mounted).
- Manual matrices: set `obj.matrixAutoUpdate = false` and `obj.matrix.copy(m)`. Remember that `Matrix4.multiply`
  post-multiplies (`m = I·T·R·S`), so the right-most matrix is applied first.
- Rotations: Euler with an explicit `rotation.order` when it matters. Use `Quaternion.slerp` for smooth orientation
  interpolation and to avoid gimbal lock.

### 5.6 Assembly sequence (`app/assembly.js`, `app/layout.js`) — implemented (D-027, D-028)

**Floor layout** (`createFloorLayout(scene, materials, shadows)` → `placeOnFloor(pieces, loadout)`,
`placeOnShip(...)`, `clear()`): each piece's floor pose is its **mounted world pose translated** (same rotation and
scale; mirrored R parts keep `scale.x = -1`), so the crane only ever translates parts. Zones, with a 1.5 m walkway
outside the platform square: wings beside the platform at their socket's z (left wing +x, right wing −x) on floor
pads, with a jig under `part.userData.support` (the TIE neck) when the root floats; weapons in a row at the front-right
(x < 0, z > 0) and thrusters at the front-left, each on a pallet. Slim props (foot, chrome rod, rubber saddle) go under
whatever still floats (`buildProps`: upward ray grid, greedy farthest-from-support placement). Every piece gets a
part-local `gripPoint` (`userData.gripPoint` or the highest point of a downward ray grid). Raycasts against parts
are made double-sided (`raycastPart`) because mirrored parts flip their winding.

**Sequence** (`createAssembly({ crane, loadout, fuselage, layout, shadows, onDone })` →
`{ start(pieces), update(dt), complete(), cancel(), status(), phase }`), one piece at a time in `loadout.pieces()`
order (wings → thrusters → weapons):

```
RAISE → MOVE_OVER_PART → SETTLE_PART → LOWER_TO_GRAB → GRAB → LIFT_SAFE → MOVE_OVER_SOCKET → SETTLE_SOCKET →
LOWER_TO_APPROACH → INSERT → SETTLE_INSERT → RELEASE → RETRACT → (next piece | PARK_XZ → PARK_Y → DONE)
```

- Each step issues `crane.userData.moveTo` targets and waits for `arrived()`. Settle steps wait for `settled()` with
  a timeout, and the grab/release steps are timed dwells.
- **Live targets**: the final grip point `G = socket.matrixWorld · local · gripPoint` and the approach point
  `A = G + outward · 0.8 m` (wings) / 0.5 m are recomputed every frame. Toggling the gear mid-sequence is followed.
  Outward is the socket's `outward`, with x negated on `R` sockets, then brought to world space.
- **Retract**: after the release the magnet rises straight up in one continuous move to the safe height (at least
  `RETRACT_LIFT` 0.6 m + `BLEND_MARGIN` 0.3 m above the release point). Once it is `RETRACT_LIFT` above the release
  and within `BLEND_MARGIN` of the safe height, the next horizontal move starts while the hoist finishes, with the
  same y target, so the rise blends into the travel without stopping.
- **Approach along the outward**: wings, nose guns and rear thrusters are lowered beside the hull and slid in
  horizontally. Top and wing-top parts come straight down.
- **Safe height**: above the fuselage (with mounted parts) and everything still on the floor, plus the carried
  part's hang below the magnet, plus 0.5 m, clamped to the hoist range.
- **Precision placement**: from `LOWER_TO_APPROACH` to `RELEASE`, `setPrecision(true)` (35 % speed and acceleration)
  and `setSwingLock(true)` (sway steadied out) keep the part on a straight line into its socket. The face targets are
  shifted by the grip offset measured at grab time. Release then `loadout.mountPiece` snaps by ≤ 0.1 mm.
- **Time** (`main.js`): while the phase is `'running'`, `crane.update` and `assembly.update` get `dt × speed` (×1/×2/×4,
  live), or 0 when paused. While `'resetting'` they get the real dt. Cameras, gear and rendering always use the real dt.
- **App modes** (`main.js`, D-029): `'preview'` (configuration rebuilds the ship live; menu `pieces` list shows the
  floor layout) → Generate → `'assembling'` → when done → `'flight'` (ship locked; menu shows View and Reset only;
  `P` fires every gun, `T` gear and `O` S-foils still work) → Reset → `'preview'`.
    - **Generate** rebuilds the pieces from the config, closes the wings, lays them on the floor and starts.
    - **Complete** mounts every remaining piece and parks the crane.
    - **Reset** (from assembling or flight) cancels, raises the magnet back to its park height (the crane has no
      manual hoist), disposes every piece and stand and rebuilds the ship from the config on the platform (preview).
    - While assembling, the Wings / Weapons / Thrusters folders are hidden and `O` is ignored.
- A full run takes about 4.5–5.5 min at ×1 (≈ 50 s per piece), about 1.2 min at ×4.

### 5.7 Cameras (`app/cameras.js`)

| Key | Camera         | Implementation hint                                                                                |
| --- | -------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Hangar orbital | `OrbitControls`, target at the hangar centre                                                       |
| 2   | Ship orbital   | `OrbitControls`, target at the fuselage world position                                             |
| 3   | Crane orbital  | `OrbitControls` around the magnet, target and camera carried along with it every frame             |
| 4   | Pilot          | `PerspectiveCamera` added to `fuselage.pilotCameraAnchor`, looking at the dashboard and windshield |
| 5   | Ship chase     | Offset behind the ship in its local frame (`localToWorld`), smoothed with lerp                     |
| 6   | First person   | `PointerLockControls` + WASD, Y clamped to eye height                                              |
| 7   | Crane magnet   | Child of the crane's `cameraMount` at the centre of the magnet face, looking down (rides the sway) |

`C` cycles through the cameras. On resize, update the `aspect` of **every** perspective camera and call
`updateProjectionMatrix()`. Enable only the active camera's controls.

Implemented in `app/cameras.js` (`createCameras({ renderer, fuselage, crane, hint })`); the menu's View folder
lists them too and follows the keys. Cameras 2 and 3 share `followOrbital` (orbit around a moving target, keeping the
view offset; camera 3 re-tracks the magnet every frame). Camera 7 is fixed at the centre of the magnet face, looking down tilted 20° towards
`+z` (screen up = `+z`, screen left = `+x`, same as the arrows); it inherits the bridge/trolley inertia and the
pendulum sway, plus a small motor vibration scaled by crane speed (`CRANE_SHAKE`). Like the pilot camera it can be looked around
with the mouse (`CRANE_LOOK`): drag turns it freely in yaw, pitch from straight down to 5° below the horizon (25° when
looking back over the magnet disc), wheel zooms (fov 30–90), double-click recentres. Both use the shared `dragLook`
helper in `cameras.js`. Camera 6 locks the
pointer on click (hint `#walk-hint` in `app.html`), walks at 4 m/s (Shift 8), stays at eye height inside the walls and
outside the platform square. Camera 4 is a head-turn, not a fixed view: drag to look (yaw ±80°, pitch +40° / −30°, with the
down limit shrinking to −8° as the head turns so it never looks into the pilot's shoulder), wheel zooms (fov 35–80),
double-click recentres (`PILOT_LOOK` in `cameras.js`).

### 5.8 Hangar and environment (`hangar/hangar.js`, `hangar/platform.js`, `scene/space.js`)

Implemented in iteration 1. The hangar and environment are **not** ship parts, so imported textures/models are allowed
here (the procedural-only rule applies to wings, thrusters and weapons).

- Hangar: interior `HANGAR = { width: 40, depth: 48, height: 16, baySpacing: 6 }`, floor at `y = 0`, back wall at
  `z = -24`, opening at `z = +24`. Built from primitives: columns with lamp strips, catwalks, crates, X-braced back
  panels, ceiling beams, two longitudinal girders at `x = ±craneRailX = ±15` (the crane runway), cyan-lit front frame.
- Textures: Poly Haven PBR sets loaded in `materials.js`. Boxes get world-scale UVs (`setBoxProjectedUVs`), so one
  material tiles consistently at its real-world `tileSize` regardless of mesh dimensions.
- Planet: `SphereGeometry` + `ShaderMaterial` with its own sun direction (so it does not light the hangar interior);
  equirectangular gas-giant texture generated on a canvas with domain-warped `ImprovedNoise` sampled on the unit
  sphere (seamless). Atmosphere: larger back-face shell, additive fresnel glow.
- Camera looking towards `+z` sees **`+x` on the left** of the screen — the planet sits at `+x` for the lower-left framing.
- Starfield: two `THREE.Points` layers on a radius-3000 sphere with `sizeAttenuation: false`.
- Lighting: `HemisphereLight` + 5 `PointLight`s (physical units, r155+): 2 on the ceiling on the ship's centre line
  (`x = 0`, above its tail and nose at `z = ±4`), plus one each on the left, right and back walls. Keep the real-light count low for performance, and add lamps as emissive meshes
  instead. `RoomEnvironment` PMREM is set as `scene.environment` for metal reflections. Emissive lamp meshes + `UnrealBloomPass` give the glow; `OutputPass` applies ACES tone mapping.
  Custom `ShaderMaterial`s include `<tonemapping_fragment>` and `<colorspace_fragment>`.
- Shadows (`app/shadows.js`, D-025): one ceiling `SpotLight` above the platform is the only shadow caster light
  (ship self-shadowing) plus a blurred **contact shadow** plane on the deck (the deck metal hides direct-light shadows).
  Only ship meshes cast (`shadows.enableOn(obj, { cast: true })` after every equip; they join layer 1 for the contact
  shadow). `shadowMap.autoUpdate = false`: anything that moves a caster must call `shadows.markDirty()` (gear, wings,
  equip today; the crane and parts in transit later). Menu View → shadows: Off / Low / High.
- Platform (`hangar/platform.js`): `PLATFORM = { size: 10, height: 0.6, railWidth: 0.6, deckHeight: 0.3 }`, centred at
  the origin. It has a recessed ribbed deck, perimeter rails with emissive side lamps, corner clamp blocks, a yellow floor outline, and a
  power console at `x ≈ -7.2` whose two cables are `TubeGeometry` swept along `CatmullRomCurve3`s. The fuselage attaches
  to `platform.userData.mountPoint`, an `Object3D` at the centre of the deck surface (`y = deckHeight = 0.3`). The
  gear wheels stand on the deck, between the ribs (the centre rib runs between the nose gear's twin wheels).

### 5.9 Part viewer (`viewer/main.js`)

- Implemented as a **gallery**: every piece laid out in space on a grid under the starfield, with a CSS2D label each.
  Back row: fuselage + cockpit (fixed), one wing per variant (left side, X-wing shown open). Front row: one weapon and
  one thruster per variant (thruster nozzle towards the camera), and a landing gear. Pieces come straight from the
  variant registries, so new variants show up automatically. Each piece stands on y = 0 (`Box3` layout per row).
- Menu (Tweakpane): View → `focus` (orbit camera onto one piece or all), `wireframe`, `normals`
  (`VertexNormalsHelper` on every mesh); then one folder per piece with its `paramSchema` sliders (live rebuild,
  old geometries disposed) and pose sliders (`open` for wings that open, `deploy` for the gear).
- Wings that open are interactive like in the main scene: clicking them (raycast on `pointerup`, ignored after an
  orbit drag), the `O` key or the folder's button toggles them with the same eased 1.2 s animation, and the `open`
  slider follows it.
- Pieces whose builder tags meshes with `userData.technique` (today the TIE wing's variable sweep) get a **sweep only**
  checkbox in their folder: it hides the untagged meshes and focuses the piece. Tag new technique meshes the same way.
- Lights are kept low so the white hull stays under the bloom threshold; only emissive parts glow.
- View → `uv checker` swaps every mesh's material for a canvas checker (cells tinted by u/v and labelled), restored
  when off and re-applied on rebuild, to validate the generated UVs.
- Still to add: a part type → variant picker if the brief needs one beyond the gallery.
- Wireframe: `material.wireframe = true`, or overlay `LineSegments(new WireframeGeometry(geo))`.
- Debug helpers: `VertexNormalsHelper` (addon), `AxesHelper`, `GridHelper`. A UV checker texture is useful for
  validating the UVs.

## 6. Theory → code map

| Theory file                                                     | Concepts to apply                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry/geometria.pdf`                                        | `BufferGeometry`, attributes, index buffers, CCW order, flat vs smooth normals, `side`, `wireframe`                                         |
| `geometry/implementacion de superficies.pdf`                    | Levels, level matrix`[N B T P]`, triangle strips, revolution as a sweep, built-in surface classes, `mergeGeometries`                        |
| `curves/introduccion a curvas.pdf`                              | Control points, interpolation vs approximation, local vs global control, parametric form                                                    |
| `curves/curvas de Bezier.pdf`                                   | De Casteljau, Bernstein bases, tangent = derivative, C0/C1 concatenation, discretisation                                                    |
| `transformations/transformaciones 3D.pdf`                       | T/R/S matrices, homogeneous coordinates, composition order,`matrixAutoUpdate`, Euler order, gimbal lock                                     |
| `transformations/arbol de la escena - 2 ejemplos prácticos.pdf` | Scene graph, local coordinate systems and pivots, subtrees (wheel/train/arm), kinematic chain,`clone()`, `mergeGeometries` for static parts |
| `transformations/three.js - concepto básicos.pdf`               | Renderer/Scene/Camera, Mesh = Geometry + Material, lights, perspective vs orthographic, helpers                                             |

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
