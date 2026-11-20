# DECISIONS.md

Log of conscious design decisions and of **where each required surface technique is used**. Read it before adding or
changing a part. AGENTS.md describes how things are built; this file records why, and what the ship already covers.

## 1. Required techniques: usage register

The brief asks for **at least one** use of each technique **across the whole ship** (not in every piece). Every part
that uses one of them must be listed here, with the file and function, so a future change does not remove the only
instance by accident. A part's look comes first: use a technique only where it fits the piece naturally.

| Technique                                     | Part / variant                                                             | Where                                                                                                                       | Curves                                                                                                                           | Notes                                                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface of revolution                         | Weapon `machineGun` (barrel)                                               | `src/parts/weapons/machineGun.js` `barrelProfile` → `src/geometry/sweep.js` `buildRevolutionGeometry`                       | `CurvePath` of 8 `CubicBezierCurve`s (`bezierChain2`)                                                                            | Jacket → S shoulder → barrel → muzzle bulb → flared crown → face → bore. Sharp knots keep hard edges. Params change the profile.                                                                                           |
| Surface of revolution                         | Weapon `minigun` (barrels, motor housing)                                  | `src/parts/weapons/minigun.js` `barrelProfile`, `housingProfile` → `src/geometry/sweep.js` `buildRevolutionGeometry`        | `CurvePath`s of `CubicBezierCurve`s (`bezierChain2`)                                                                             | Barrel: breech collar → curved shoulder → tube → muzzle lip → face → bore (`barrelLength` rebuilds it). Housing: back face → rounded bell → waist → flared collar → front face (C1 bell and waist).                        |
| Surface of revolution                         | Thruster `rearEngine` (casing, nozzle, cone, core; nose cone off the tail) | `src/parts/propulsors/common.js` `engineProfile` (`buildEngineNacelle`) → `src/geometry/sweep.js` `buildRevolutionGeometry` | `CurvePath`s of `CubicBezierCurve`s (`bezierChain2`), one per material run                                                       | Groove, raised stripe, waist, collar, curved converging nozzle (C1 with the collar), thick lip, petal cone to the core. `length` and `nozzleFlare` change the profile.                                                     |
| Surface of revolution                         | Thruster `quadBlock` (throat cone, core)                                   | `src/parts/propulsors/quadBlock.js` `buildCell` → `src/geometry/sweep.js` `buildRevolutionGeometry`                         | `CubicBezierCurve`s (`bezierChain2`)                                                                                             | Small detail inside each nozzle; the block's main technique is the variable sweep.                                                                                                                                         |
| Sweep along a curved path (oriented sections) | Weapon `minigun` (ammo feed chute)                                         | `src/parts/weapons/minigun.js` `buildChuteGeometry` → `src/geometry/sweep.js` `buildVariableSweepGeometry`                  | `CubicBezierCurve3` path, frames from `levelMatrices` (`method: 'parallel'`); section = rounded rectangle, 8 `CubicBezierCurve`s | **Main use.** Leaves the receiver backwards and bends ~90° into the hull; constant section oriented along the path (D-022).                                                                                                |
| Sweep along a curved path (oriented sections) | Wing `plane` (panel)                                                       | `src/parts/wings/planeWing.js` `buildPlaneWing` → `src/geometry/sweep.js` `buildVariableSweepGeometry`                      | `CubicBezierCurve3` span path, frames from `levelMatrices` (`method: 'up'`)                                                      | Path leaves the root along +x and curves back to the tip; sections follow its tangent. Secondary: subtle, only visible with `sweep > 0` (default 0.6). The minigun chute is the clear use.                                 |
| Variable-shape sweep                          | Wing `tie` (whole wing: neck → flare → wing)                               | `src/parts/wings/tieInterceptor.js` `sectionAt` → `src/geometry/sweep.js` `buildVariableSweepGeometry`                      | 11 `CubicBezierCurve`s per section (`bezierChain2`)                                                                              | **Main use.** Starts as a rectangle flush on the hull and ends as the full wing outline (half-octagon back extended forward into two daggers, curved notch edges). Different start and end shapes (D-021).                 |
| Variable-shape sweep                          | Thruster `quadBlock` (each of the 4 cells: intake → casing → nozzle)       | `src/parts/propulsors/quadBlock.js` `buildCell` `sectionAt` → `src/geometry/sweep.js` `buildVariableSweepGeometry`          | `roundedRectangle` (`src/geometry/curves.js`): 9 `CubicBezierCurve`s per section                                                 | Square intake widening to the casing, then the nozzle morphs square → rounded square / circle (corner radius grows, sides even out). `roundness`, `nozzleFlare`, `length`, `gap` rebuild it (D-023).                       |
| Variable-shape sweep                          | Wing `plane` (panel)                                                       | `src/parts/wings/planeWing.js` `airfoilAt` → `src/geometry/sweep.js` `buildVariableSweepGeometry`                           | Airfoil = `CurvePath` of 2 `CubicBezierCurve`s (`bezierChain2`)                                                                  | Chord tapers, thickness ratio drops (`rootThickness` → 0.05) and camber flattens along the span: the shape changes, not just its scale. Round LE (C1), sharp TE knot. Secondary: same airfoil family at both ends (D-021). |
| Variable-shape sweep                          | Wing `xwing` (each S-foil panel)                                           | `src/parts/wings/xWingSFoils.js` `buildPanelGeometries` → `src/geometry/sweep.js` `buildVariableSweepGeometry`              | `roundedRectangle` (`src/geometry/curves.js`): 9 `CubicBezierCurve`s per section                                                 | Squared section with softened edges; chord (2.0 → 1.5 m), its centre and thickness (0.16 → 0.08 m) taper at different rates along a straight path. Secondary use (D-014).                                                  |

**Does not count** (kept here so nobody relies on it):

- Platform power cables (`src/hangar/platform.js`): built-in `TubeGeometry` on a `CatmullRomCurve3`. Hangar
  decoration, not a ship part, and not our generator.
- Fuselage tapered boxes (`src/parts/fuselage.js` `taperedBox`): deformed `BoxGeometry`, no curves. The fuselage is
  fixed, not an interchangeable part.
- TIE wing red plates and white struts/hub (`src/parts/wings/tieInterceptor.js` `buildOuterFace`, `buildStruts`):
  `ExtrudeGeometry` flat plates and primitives, details on top of the sweep.

## 2. Decision log

### D-001 Fuselage is primitives only

The fixed fuselage uses no curves or sweeps. It is built from `taperedBox`es (a `BoxGeometry` with moved corners, with
planar faces and flat normals), boxes, cylinders and spheres. The required techniques live in the interchangeable parts.

### D-002 Fuselage rests on the platform deck

`platform.userData.mountPoint` is at the deck surface (`PLATFORM.deckHeight = 0.3`), not on the rail tops, so the
landing gear wheels stand on the deck. The centre rib passes between the nose gear's twin wheels; the main gears' wheels
sit between the centre rib and the ±2.2 m ribs (D-024).

### D-003 Matte hull and faint glass reflections

The hull faces are flat, so a glossy finish reflects the `RoomEnvironment` and the lamps over a whole face at once.
`hullPaint`/`hullRed` use roughness 0.9, metalness 0 and `envMapIntensity` 0.25, and the paint is off-white (`0xaeaca6`), not white: under the shadow spot (D-025) a whiter hull went past the bloom threshold and burned the image. The bloom threshold is 1.0, so only emissive lamps, screens and exhaust glow. `chrome` is roughness 0.35 so its highlights stay small. The canopy `glass` uses `envMapIntensity` 0.35.

### D-004 Pilot instead of an astromech droid

The droid was removed. A seated pilot (primitives) sits low in a tub sunk into the hull so the helmet clears the 0.55 m
canopy, so the legs are not modelled. The pilot camera anchor is at the pilot's eyes.

### D-005 Techniques spread across the ship, look first

Not every piece has to use every technique. Each piece uses the technique that matches what it represents, and the
register in section 1 guarantees each technique appears at least once overall.

### D-006 Machine gun: revolution for the barrel only

A real barrel is a turned part, so it is a surface of revolution with a Bézier profile. The receiver, rail, sights,
fins, cocking handle, pylon and magazine are primitives (allowed for details). No sweep was forced into the gun.

### D-007 Weapons are built for the left side and mirrored for the right

Every weapon fires along `+z` with `+y` up and is built for the left side. The right copy uses `scale.x = -1`. Three.js flips
the face winding automatically for negative-determinant world matrices, so no `DoubleSide` is needed.

### D-008 Some wings will expose hardpoints (deferred)

Some wing variants (not all) will expose their own sockets (`userData.sockets`, e.g. a wing-tip weapon or thruster
mount), for the X-wing look and a more interesting crane order. Placement resolves to the wing socket when the chosen
wing has one, otherwise to the fuselage socket. Assembly order must then be wings → thrusters → weapons.

### D-009 Cover plates on unused sockets

Every part socket (wing roots and hardpoints, not gear) has a cover. The side and tail ones are closed hatches: a hull-paint
panel inside a thin dark seam with four chrome bolts (primitives). An all-dark plate read as an open mount, so
empty sockets must look closed. The top ones are round pads (D-012). Each cover is added to the body as a **sibling** of the socket, stored in `socket.userData.cover`.
`fuselage.userData.mountPart(name, part)` adds the part and hides the cover, and `unmountPart(name)` removes the parts
and shows it again. Thruster sockets sit on the outer face of the tail plate (`REAR_PLATE_DEPTH`). Covers on nose-side
sockets are yawed to follow the nose taper.

### D-010 Instant mounting in preview

In the preview mode (before Generate, and after an assembly finishes), `app/loadout.js` still mounts parts instantly
when the menu changes. The crane only takes over on Generate (D-028). Replaced parts' geometries are disposed, and
the shared materials are kept.

### D-011 Hardpoints are positions shared by weapons and thrusters

Sockets are named by **where** they are, not by what they hold: `socket_nose_*`, `socket_top_*`, `socket_tail_*`
(plus `socket_wing_*` for the wing roots). `HARDPOINTS` in `fuselage.js` groups them in mirrored L/R pairs and lists
the part kinds each accepts:

| Hardpoint | Sockets            | Accepts                           |
| --------- | ------------------ | --------------------------------- |
| `nose`    | `socket_nose_L/R`  | weapon                            |
| `top`     | `socket_top_L/R`   | weapon, thruster                  |
| `tail`    | `socket_tail_L/R`  | thruster                          |
| wings     | from the wing part | weapon, thruster (planned, D-008) |

A hardpoint holds one kind at a time (`loadout.equip` throws otherwise; the menu will have to prevent that choice once
thrusters exist). Sockets keep the ship orientation, and each stores `outward` (hull normal, left-side frame). Part
builders take `{ outward }` and grow their pylon that way, so the same part stays upright on a side or a top
hardpoint. Weapons do not accept the tail, because it faces backwards.

### D-012 Top hardpoint: painted fairing with round pads

The former dark "spine" looked like a cover plate. It is now a raised fairing in hull paint with red edge trims and dark
grooves (part of the hull). Its two empty sockets show round white pads with a red ring and a chrome hub, so they read
differently from the side plates. Its sockets set `clearance: 0.65`, so a weapon mounted there stands on a tall vertical pylon. The machine gun's barrel
then runs about 0.5 m above the canopy top, and the minigun's lowest barrel about 0.17 m (with 0.4 m the minigun's
lower barrels were level with the canopy and looked aimed at the cabin; with the default 0.12 m every gun was).

### D-013 Menu: Tweakpane, top-right

The UI uses Tweakpane 4 (allowed by the brief), whose default pane is fixed to the top-right corner. `app/menu.js`
edits a plain `config` object and calls back into `main.js`. The options come from the variant registries and from
`hardpointsFor(kind)`, so new variants and hardpoints show up without menu changes. It currently has Weapons → type
(only `Machine gun`) and position (`Nose sides`, default, or `Top (rear)`). For the comparison with the course demo's
dat.gui menu, see `docs/menu-libraries.md`.

### D-014 X-wing S-foils: simple, squared panels

`wingVariants.xwing` (the default wing): on each side an upper and a lower panel hinged at the root (dark fairing,
chrome hinge pins along z) that open into an "X". Unlike the real X-wing, there are no fixed engines or wing-tip
cannons. Weapons and thrusters stay interchangeable through hardpoints.

The first version used the curved, variable-shape sweep for these panels, which made the X-wing too complex. They
then became flat `slab`s (a `BoxGeometry` with moved corners), but the brief only allows primitives for details, so a
main part built from boxes was a risk. Each panel is now a simple variable-shape sweep along a straight path: a
`roundedRectangle` section (squared, edges softened with a corner radius of half the local thickness) whose chord, chord
centre and thickness taper at different rates from root to tip, keeping the squared look. The same sweep is split into
white / red / white runs for the stripe, with end caps at the root and tip. The geometric param stays `span`, which
rebuilds the sweep. The lower panel is the upper one flipped (`scale.y = -1`).

### D-015 Wing hardpoint lives in the wing

Each upper panel carries `socket_wing_top` on its top surface, 0.9 m from the root, with a round pad cover like the
fuselage top. It is a child of the upper hinge, so a mounted part follows the panel when the wings open. The socket is
`side: 'L'`, because the right wing is already mirrored and the part must not be mirrored twice. The loadout exposes it
as hardpoint `wing` ("Wings (top)", accepts weapon and thruster), resolved from the mounted wings
(`wing.userData.sockets.top`). Rebuilding the wings (menu sliders) takes the parts off the wing hardpoint and mounts
them again on the new wings.

### D-016 `O` opens and closes the wings

The `O` key (or the menu button) toggles the S-foils with the same eased toggle as the gear (`stepToggle` in
`main.js`, 1.2 s, `smoothstep`). The wings start closed (parked). `setOpen(t)` rotates the upper hinge by `+14°·t`
and the lower one by `−14°·t` about z. The opening is a transform, so it does not count as a geometric wing param.

### D-017 Shared socket helpers

`src/parts/sockets.js` holds `mountPart` (mirrors on `R`, hides the cover), `unmountPart` and `buildPadCover`, used
by the fuselage, the wings and the loadout, so every part that offers sockets follows the same contract.

### D-018 Plane wing carries the curved, variable-shape panel

`wingVariants.plane`: one fixed panel per side (no opening, `opens: false`) with a 3° dihedral and a dark root fairing.
The panel is the airfoil variable-shape sweep along a backwards-curving Bézier span path that used to be the X-wing's
(D-014), so this variant holds the wing entries of the technique register. Params `span`, `tipChord`, `sweep` and
`rootThickness` all rebuild it. Both wing variants default to `span` 4 m (range 3.2–5 m) for a longer, more
dramatic silhouette; they may stick out past the platform deck. It offers the same top hardpoint as the X-wing (0.9 m from the root, round pad). In the
menu, switching wing type resets the params to the new variant's defaults, rebuilds the "Shape" sliders from its
`paramSchema`, and hides the open/close button for wings that do not open.

### D-019 Rear engine: one big centred thruster on a new `rear` hardpoint

`thrusterVariants.rearEngine` is a single large engine modelled on one of the four X-wing engines, but sized to fill
the tail (casing radius 0.44 m, collar up to 0.59 m). It is kept short (0.7–1.3 m, default 0.9 m) so it barely
protrudes: less realistic, but it looks much better with the ship. It was chosen over a 2×2 block of square engines
because it reads clearly as an engine and its turned shape is a natural surface of revolution; the 2×2 block came
later as `quadBlock` (D-023).

- A single centred part did not fit the mirrored L/R pairs, so the fuselage got `HARDPOINTS.rear` with one socket,
  `socket_rear` (`side: 'C'`, not mirrored, `outward` −z) at the centre of the tail plate.
- `rear` and `tail` use the same plate, so they list each other in `overlaps` and `loadout.equip` treats an
  overlapping hardpoint as taken. The `socket_rear` cover is a group holding the two tail hatches, so mounting the
  engine hides both without touching `sockets.js`.
- The variant is rear-only (`hardpoints: ['rear']`); the menu rebuilds the thruster position list for the chosen type.
- Body vs exhaust: white casing with a dark groove and a raised red stripe; dark slatted collar and white nozzle. Seen
  from behind it follows the reference: a thick white lip, a cone of white petals converging inwards, and a small
  emissive orange core (`materials.exhaust`, intensity 4.5, caught by the bloom) behind a fan of dark blades and a hub.

### D-020 One file per variant, one map file per part kind

`src/parts/wings.js`, `weapons.js` and `thrusters.js` only expose the id → variant map (`wingVariants`,
`weaponVariants`, `thrusterVariants`) that the loadout, menu and viewer read. Each variant is coded in its own
descriptive file and exports its variant object (`label`, `defaults`, `paramSchema`, `build`, plus `opens` /
`hardpoints` when it has them): `wings/xWingSFoils.js`, `wings/planeWing.js`, `wings/tieInterceptor.js`, `weapons/machineGun.js` and
`propulsors/rearEngine.js`. Code shared by the variants of one kind goes in that folder's `common.js` (today
`wings/common.js`: root chord, fairing, top hardpoint; `weapons/common.js`: pylon, helpers; `propulsors/common.js`:
engine nacelle, `radialRing`). A variant file reads its own local `defaults`, never the map,
so the map can import every variant without circular imports. Adding a variant = new file + one line in the map.

### D-021 TIE Interceptor wing: the sweep starts on the hull and ends as the wing

The lecturer judged the plane wing's variable-shape sweep not enough: its section is an airfoil at both ends, only
its proportions change. The plane wing is kept as it is (it looks good and holds the curved-path sweep), and
`wingVariants.tie` (`wings/tieInterceptor.js`), inspired by the TIE Interceptor
([reference](https://www.starwars.com/databank/tie-interceptor)), carries the technique clearly:

- The whole wing is one variable-shape sweep per side along a straight path leaving the hull along +x. The section is
  always 11 cubic Béziers (one per edge, same vertex count): a **rectangle** at the start, lying flat on the hull below
  the red side stripe (so the junction with the boxy fuselage is flush and smooth), and the **full wing outline** at
  the end: a half-octagon at the back whose top and bottom edges run forward to a shoulder, then narrow into two
  mirrored daggers whose tips sit near the centre line (0.4 × span). Inner points at the tip height and the same
  distance ahead of the socket give each dagger a straight inner edge before the curved notch edges.
- Along the path: the root rectangle shrinks to a slim neck with an ease-out (fast at the hull, like a fillet), the
  neck stays constant (the hardpoint sits on top of it), then a short linear flare grows it into the wing outline,
  and a constant rim gives the wing edge. The end cap is the outer wing face.
- Colours follow the reference with white for the light grey and red for the dark solar panels: white neck and rim,
  red flare (inner face) crossed by white struts along the straight lines the outline vertices follow, red extruded
  plates on the white outer face, white hub.
- Static (`opens: false`) and planar, without the reference's inward bend, so the wing face stays the end of the
  sweep. Params `pylonLength`, `span`, `tipReach`, `rearDepth` all rebuild it; `span` ≤ 1.6 keeps the lower tip
  ≥ 0.19 m above the deck.
- The forward daggers are long, as in the reference: tip 1.46–4.4 m ahead of the neck centre (`tipReach` 0.4–2.5, default 1.5 → 3.0 m).
- The three sweep meshes are tagged `userData.technique = 'variableSweep'`; the part viewer's **sweep only** checkbox
  (in the wing's folder) hides everything else (struts, plates, hub, pad) and focuses the wing, to show the technique
  on its own.

### D-022 Minigun: rotary barrels, curved feed chute, wing and top hardpoints only

Second weapon (`weaponVariants.minigun`, `weapons/minigun.js`), inspired by an M134-style rotary gun:

- **Hardpoints**: `hardpoints: ['wing', 'top']`. It is too big for the cockpit sides (`nose`), so it only goes on the
  wings or behind the cockpit. The menu now builds the weapon position list per variant (`partFolder` in
  `app/menu.js`, shared with the thrusters).
- **Barrels**: `barrelCount` 5–8 (step 1) barrels on a circle around the spindle. The circle radius grows with the
  count so neighbouring breech collars never touch (`(collar + gap) / sin(π / n)`, at least 0.06 m). All barrels share
  one revolution geometry. Clamp rings are flat `ExtrudeGeometry` discs with one hole per barrel (detail).
- **Motor housing**: a second Bézier-profile revolution between the receiver and the rotor.
- **Feed chute**: the clear use of the curved-path sweep (the plane wing's is subtle). A rounded-rectangle section
  (C1 corners) swept along a `CubicBezierCurve3` that leaves the back of the receiver and bends into the hull behind
  the pylon. The path is built from the hull normal, so it fits the wing and top sockets. Frames use parallel
  transport. Both ends are buried, so no caps. Tagged `userData.technique = 'curvedSweep'` for the viewer's
  **sweep only** checkbox.
- **Shooting spin**: the barrels, rings and spindle live in a `rotor` group. `userData.fire()` queues one step and
  `userData.update(dt)` turns the rotor by exactly one barrel (`2π / n`, e.g. 72° with 5 barrels) in 0.12 s with a
  smoothstep. The angle is rebuilt from an integer step count, so it never drifts. `userData.muzzle` (outside the
  rotor) marks the top barrel's muzzle, always occupied after a step: the anchor for the future muzzle flash. The
  barrel count is not changed while shooting, so the rotor is never rebuilt mid-spin. The part viewer has a **Fire**
  button; the main scene does not call `fire`/`update` yet.
- Receiver, top rail, side plates, bolts and the rear block are primitives. Pylon, `supportDistance`, `box` and `place`
  moved to `weapons/common.js`, shared with the machine gun.

### D-023 Thrusters: quad block on the rear, the engine also on top and on the wings

- **`quadBlock`** (`propulsors/quadBlock.js`, `hardpoints: ['rear']` only, following `QUAD_THRUSTER_PLAN.md`):
  a 2×2 block of square engines in a shared dark frame on the tail plate (1.1 × 0.8 m, inside the tail section). Each
  cell is one variable-shape sweep of a `roundedRectangle` (9 Béziers, seam mid-side) along a straight `LineCurve3`,
  split into intake / casing / nozzle runs with `vStart`/`vEnd`. The corner radius never reaches 0 (`MIN_CORNER`) nor
  the smaller half size, so no piece has zero length (no zero normals). The nozzle exit is kept inside the cell slot so
  neighbouring nozzles never touch at full flare. One cell's geometries are shared by the four meshes. Lip face
  (`ShapeGeometry` with a hole), throat cone and core (revolutions), petals and blades (`radialRing`), frame, ribs and
  bolts are details. Params `length`, `roundness`, `nozzleFlare`, `gap`.
- **Engine everywhere** (`rearEngine`, label "Engine", `hardpoints: ['rear', 'top', 'wing']`): no separate variant,
  the same engine is just pickable on more positions. The nacelle moved to `propulsors/common.js`
  (`buildEngineNacelle`, optional adapter plate). On the tail it sits flush with its adapter plate. On the top and
  wing hardpoints it lies on a dark holder, nozzle backwards (-z), 0.1 m above the hull, with a Bézier-revolution nose
  cone closing the intake; it ignores the socket's gun `clearance` (it does not aim forward).
    - **Top**: one full-size engine for the pair. Sockets now carry `toPairCentre`; both build a holder, only the left
      one builds the engine, at the pair centre (x = 0). Loadout passes `side` and `toPairCentre` to every `build`.
    - **Wing**: one engine per wing, centred over each wing's hardpoint, scaled by `WING_SCALE` = 0.45 (radius ≤ 0.27 m,
      `length` still in metres). Full size (1.0–1.2 m wide) did not fit between the hull and the flare on the TIE neck,
      and an earlier 0.36 pod looked too small. 0.45 fits every TIE neck length (0.9–1.6, 1.3 cm spare at 0.9): a
      vertex check over every wing, open/closed, min/max length and flare found no hull or wing vertex inside the
      engine, on the wings or on top.
- **No overlap with guns**: a hardpoint holds one part kind, so an engine and a gun never share one. The menu shows
  this up front: each kind's position list leaves out the hardpoints the other kind is using, plus the ones they
  overlap (`takenHardpoints` in `app/menu.js`), and refreshes when the other kind moves. A scripted check of
  every wing × open/closed × weapon hardpoint × thruster hardpoint combination found no gun/thruster mesh boxes
  intersecting.

### D-024 Tricycle landing gear

Two centre-line gears (front and back, twin wheels 0.44 m apart) read as a bicycle under a ~9 m ship with wide wings,
not as "apoyos suficientes". The gear is now a tricycle: the centred nose gear (`socket_gear_front`, z = 2.6) and two
main gears under the body sides (`socket_gear_back_L/R`, x = ±0.45, z = -2.6), all built by the same
`buildLandingGear` and driven together by `setGearDeploy`. The main gears' twin wheels span x ≈ 0.17–0.73, so they stay
inside the body half-width (0.75) when retracted and miss the platform deck ribs.

### D-025 Cheap, on-demand ship shadows

Performance first: no shadows on the point lights (each would need 6 shadow renders). One ceiling `SpotLight` above the
platform (1 render) casts, and only the ship casts, so the caster set stays small. The deck and walls use
`metalness: 1` materials, which ignore diffuse light, so a direct-light shadow on them is almost invisible: the ship is
grounded with a contact shadow instead (the three.js `webgl_shadow_contact` technique: ship depth seen from below on
layer 1, two blur passes, transparent plane on the deck), which works on any material. Both maps are rendered only when
`markDirty()` is called (`shadowMap.autoUpdate = false`), so a still scene costs no shadow pass. The two ceiling point
lights over the ship were dimmed (180 → 60) to make room for the spot. Quality Low = 1024 spot / 256 contact, High =
2048 / 512, Off disables both.

### D-026 Underhung crane with a magnet tip, hoist and pendulum sway

The ceiling girders at x = ±15 (`HANGAR.craneRailX`) run along z and the ceiling beams sit right on top of them, so the crane is
**underhung**: the bridge spans x, rolls along z under the girders, and the trolley runs along x under the bridge (the
inverse of the axes first sketched in AGENTS §5.5). The girders were moved out from x = ±10 to ±15 so the trolley
reaches x = ±13.5: the platform covers |x| ≤ 5, which leaves a floor strip about 8 m wide on each side for the parts
waiting to be mounted. The tip is an **electromagnet** instead of a claw: picking a part
up is `attachPoint.attach(part)` and dropping it is `socket.attach(part)`, with no claw joints to pose around each part
shape. The cable started with a fixed length; the brief (p. 4) asks for a holder positioned in three dimensions that lowers
to the pieces, so it is now a hoist: the cable length varies between 1.5 and 10.9 m (magnet face at y = 9.6 down to
0.2) and the drum turns with it (a visible joint). The pendulum length follows the cable. In automatic mode the
damping is critical for the current length (2·√(g/L)): heavier damping would be overdamped and creep in slower.
For a realistic ride from the magnet camera (7), the carriages accelerate and brake at 1.5 m/s² up to 3.5 m/s (trolley) / 4 m/s (bridge)
(braking cap v ≤ √(2·a·d) so they ease into the end stops) and the magnet hangs from a pendulum per axis driven by the
carriage acceleration (θ'' = -(g/L)·sin θ - (a/L)·cos θ - c·θ'), substepped at 120 Hz. The damping c = 2.2 /s is close
to critical, like an anti-sway hoist: the magnet leans ~7° while accelerating and settles in about 3 s after a stop
instead of swinging back and forth, so the crane feels responsive. The two ceiling point lights over the ship were moved
down from y = 13.5 to 12 so the bridge and trolley do not pass through them. The crane does not cast shadows (it would
darken the ship under the spot light).

Manual driving is horizontal only (arrows). The hoist moves only in the automatic assembly, which also uses two
placement aids (D-028): a precision mode at 35 % speed and acceleration, and a swing lock that stops the carriages
from driving the pendulum and steadies it out at 6 /s, like a rigger's guide lines.

### D-027 Floor layout: mounted pose, translated

Each piece waits on the floor in its **mounted world orientation**, only translated. So the crane never rotates a
part in transit: lift, carry, lower. `Object3D.attach` keeps negative scale, so mirrored right-side parts work too.
Placement first mounts everything and measures it, then detaches every piece before moving any. Parts on the wing
hardpoint hang from a wing socket, and moving the wing first would carry them along.

Zones keep a 1.5 m walkway around the platform:

- **Wings** lie beside the platform at their socket's z, so the crane carries them straight across.
- **Weapons** sit in a row at the front-right.
- **Thrusters** sit in a row at the front-left, mirroring the weapons.

Stands are primitives:

- **Wing pads.**
- **A jig** under `part.userData.support`. The TIE wing declares a point in the middle of its neck, so the wing stays
  level and the jig is centred on the neck.
- **Pallets** under the rack pieces.
- **Slim props** under any underside still floating more than 10 cm above its rest. They are placed greedily at the
  point farthest from every support, and each rod stops under the lowest point of its saddle footprint, so it never
  crosses the part.

The TIE wing root gets a start cap and a dark flange, so it is not see-through off the hull.

Every piece gets a part-local grip point for the magnet. All raycasts against parts are double-sided, because
mirrored parts reverse their triangle winding and a front-side-only raycast misses their faces.

### D-028 Assembly sequence: outward approach, live targets, precise insertion

The sequence follows the brief: move over the piece, lower and grab, lift to a safe height, move over the socket,
lower, release, retract. Design choices:

- **Outward approach.** Parts are inserted along their socket's outward normal from an approach point 0.8 m
  (wings) / 0.5 m away. Side and rear parts are lowered beside the hull and slid in, never dropped through it. Top
  parts simply come down.
- **Retract straight up, blended.** After a release the magnet rises vertically to the safe height in one move, and
  only moves horizontally once it is clear: 0.6 m above the release point (`RETRACT_LIFT`) and within 0.3 m of the
  safe height (`BLEND_MARGIN`). The next move then starts while the hoist is still rising, with the same y target,
  so the rise curves into the travel instead of stopping. Earlier versions slid back out along the outward and
  dragged the magnet through the TIE wing panel above its neck and through the nose guns, which a raycast check of
  the magnet's path showed. A later version rose in two stops before travelling. The grip point is the highest point
  of the part, so nothing of it is above the magnet. When a part is mounted high, the safe height is raised to leave
  room for the blend.
- **Live targets.** Targets come from the socket's current world matrix every frame, so the landing gear (T) can move
  the ship mid-sequence.
- **Safe height.** It is computed from `Box3`s of the ship and of everything on the floor, plus the carried part's
  hang below the magnet.
- **Precise insertion.** Measured in simulation, braking at the end of the slide swung pieces 4–10 cm past their
  socket into the hull. From the final approach until the release, the crane now runs in precision mode
  with the swing lock on, and targets are corrected by the grip offset measured at grab time. Pieces then never pass
  their socket, and the release snap (`mountPiece`) is ≤ 0.1 mm.
- **Re-issued targets.** Targets are re-issued every frame, so a carriage only clears its "arrived" flag when its
  target really changes.
- **Simulation time.** The crane and the sequence get `dt × speed` (×1/×2/×4, live) or 0 when paused. Cameras,
  gear and rendering keep the real dt.
- **Menu.** Configuration is hidden while assembling.
- **Reset.** It raises the magnet before handing the crane back, because the manual controls have no hoist.

Simulated results:

- Every configuration completes in order: wings, then thrusters, then weapons.
- No collisions with floor pieces or the ship in transit.
- Complete, cancel, restart and a gear toggle mid-run all behave correctly.
- About 50 s per piece at ×1.

### D-029 Flight mode after the assembly, guns fire with P

When the sequence finishes, the app enters **flight mode** instead of going back to the editable preview. Flight
itself is not implemented yet. The assembled ship is locked: config edits are ignored, and the menu shows only View
and Reset. `T` (gear) and `O` (S-foils) still work. **Reset** always returns to the start state, from a run or from
flight: the ship is rebuilt from the config on the platform, with the parts menu live. There is no longer an "empty"
mode.

`P` fires every mounted gun, **only in flight mode**. Holding it down fires automatically, one shot every 0.15 s
(the minigun turns one barrel in 0.12 s), until it is released.

- **The spark.** It is a primitive detail, allowed for secondary elements: a stretched sphere core and three crossed
  open cones along +z, on each gun's `muzzle` node.
- **Its material.** One additive `MeshBasicMaterial` with an HDR colour (> 1), so the bloom pass makes it glow without
  adding real lights. The material is transparent, so it never casts shadows.
- **The fade.** It shrinks and hides in 0.1 s.
- **The minigun** also turns its cluster by one barrel (the existing `spinner`).
- **Shadows.** The shadow map is re-rendered for 0.3 s after a shot, while the rotor turns.
