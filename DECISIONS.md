# DECISIONS.md

Log of conscious design decisions and of **where each required surface technique is used**. Read it before adding or
changing a part. AGENTS.md describes how things are built; this file records why, and what the ship already covers.

## 1. Required techniques: usage register

The brief asks for **at least one** use of each technique **across the whole ship** (not in every piece). Every part
that uses one of them must be listed here, with the file and function, so a future change does not remove the only
instance by accident. A part's look comes first: use a technique only where it fits the piece naturally.

| Technique                                     | Part / variant                                     | Where                                                                                        | Curves                                                                      | Notes                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Surface of revolution                         | Weapon `machineGun` (barrel)                       | `src/parts/weapons.js` `barrelProfile` → `src/geometry/sweep.js` `buildRevolutionGeometry`   | `CurvePath` of 8 `CubicBezierCurve`s (`bezierChain2`)                       | Jacket → S shoulder → barrel → muzzle bulb → flared crown → face → bore. Sharp knots keep hard edges. Params change the profile.                                                     |
| Surface of revolution                         | Thruster `rearEngine` (casing, nozzle, cone, core) | `src/parts/thrusters.js` `engineProfile` → `src/geometry/sweep.js` `buildRevolutionGeometry` | `CurvePath`s of `CubicBezierCurve`s (`bezierChain2`), one per material run  | Groove, raised stripe, waist, collar, curved converging nozzle (C1 with the collar), thick lip, petal cone to the core. `length` and `nozzleFlare` change the profile.               |
| Sweep along a curved path (oriented sections) | Wing `plane` (panel)                               | `src/parts/wings.js` `buildPlaneWing` → `src/geometry/sweep.js` `buildVariableSweepGeometry` | `CubicBezierCurve3` span path, frames from `levelMatrices` (`method: 'up'`) | Path leaves the root along +x and curves back to the tip; sections follow its tangent. Subtle: only visible with `sweep > 0` (default 0.6). A clearer dedicated use is still a goal. |
| Variable-shape sweep                          | Wing `plane` (panel)                               | `src/parts/wings.js` `airfoilAt` → `src/geometry/sweep.js` `buildVariableSweepGeometry`      | Airfoil = `CurvePath` of 2 `CubicBezierCurve`s (`bezierChain2`)             | Chord tapers, thickness ratio drops (`rootThickness` → 0.05) and camber flattens along the span: the shape changes, not just its scale. Round LE (C1), sharp TE knot.                |

**Does not count** (kept here so nobody relies on it):

- Platform power cables (`src/hangar/platform.js`): built-in `TubeGeometry` on a `CatmullRomCurve3`. Hangar
  decoration, not a ship part, and not our generator.
- Fuselage tapered boxes (`src/parts/fuselage.js` `taperedBox`): deformed `BoxGeometry`, no curves. The fuselage is
  fixed, not an interchangeable part.
- X-wing wing panels (`src/parts/wings.js` `slab`): deformed `BoxGeometry`, no curves (D-014).

## 2. Decision log

### D-001 Fuselage is primitives only

The fixed fuselage uses no curves or sweeps. It is built from `taperedBox`es (a `BoxGeometry` with moved corners, with
planar faces and flat normals), boxes, cylinders and spheres. The required techniques live in the interchangeable parts.

### D-002 Fuselage rests on the platform deck

`platform.userData.mountPoint` is at the deck surface (`PLATFORM.deckHeight = 0.3`), not on the rail tops, so the
landing gear wheels stand on the deck. The centre rib passes between each pair of twin wheels.

### D-003 Matte hull and faint glass reflections

The hull faces are flat, so a glossy finish reflects the `RoomEnvironment` and the lamps over a whole face at once.
`hullPaint`/`hullRed` use roughness 0.75 and `envMapIntensity` 0.4. The canopy `glass` uses `envMapIntensity` 0.35.

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

### D-010 Instant mounting until the crane exists

Until the crane and assembly exist, `app/loadout.js` mounts parts instantly when the menu changes. It disposes the
replaced parts' geometries but keeps the shared materials.

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
differently from the side plates. Its sockets set `clearance: 0.4`, so a weapon mounted there stands on a tall vertical pylon. Its barrel then
runs about 0.25 m above the canopy top instead of in line with it (with the default 0.12 m it was aimed at the cabin).

### D-013 Menu: Tweakpane, top-right

The UI uses Tweakpane 4 (allowed by the brief), whose default pane is fixed to the top-right corner. `app/menu.js`
edits a plain `config` object and calls back into `main.js`. The options come from the variant registries and from
`hardpointsFor(kind)`, so new variants and hardpoints show up without menu changes. It currently has Weapons → type
(only `Machine gun`) and position (`Nose sides`, default, or `Top (rear)`). For the comparison with the course demo's
dat.gui menu, see `docs/menu-libraries.md`.

### D-014 X-wing S-foils: simple, squared, built from primitives

`wingVariants.xwing` (the default wing): on each side an upper and a lower panel hinged at the root (dark fairing,
chrome hinge pins along z) that open into an "X". Unlike the real X-wing, there are no fixed engines or wing-tip
cannons. Weapons and thrusters stay interchangeable through hardpoints.

The first version used the curved, variable-shape sweep for these panels, which made the X-wing too complex. Each panel
is now a flat, squared `slab`: a `BoxGeometry` with its corners moved, slightly tapered with planar faces and flat
normals. A slightly larger red slab forms the stripe. No surface technique is used. The brief still needs a geometric
param per wing, so `span` is kept and rebuilds the slabs. The lower panel is the upper one flipped (`scale.y = -1`).

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
because it reads clearly as an engine and its turned shape is a natural surface of revolution; the 2×2 block is kept
for later in `QUAD_THRUSTER_PLAN.md`.

- A single centred part did not fit the mirrored L/R pairs, so the fuselage got `HARDPOINTS.rear` with one socket,
  `socket_rear` (`side: 'C'`, not mirrored, `outward` −z) at the centre of the tail plate.
- `rear` and `tail` use the same plate, so they list each other in `overlaps` and `loadout.equip` treats an
  overlapping hardpoint as taken. The `socket_rear` cover is a group holding the two tail hatches, so mounting the
  engine hides both without touching `sockets.js`.
- The variant is rear-only (`hardpoints: ['rear']`); the menu rebuilds the thruster position list for the chosen type.
- Body vs exhaust: white casing with a dark groove and a raised red stripe; dark slatted collar and white nozzle. Seen
  from behind it follows the reference: a thick white lip, a cone of white petals converging inwards, and a small
  emissive orange core (`materials.exhaust`, intensity 4.5, caught by the bloom) behind a fan of dark blades and a hub.
