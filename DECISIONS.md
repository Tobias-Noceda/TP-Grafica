# DECISIONS.md

Log of conscious design decisions and of **where each required surface technique is used**. Read it before adding or
changing a part. AGENTS.md describes how things are built; this file records why, and what the ship already covers.

## 1. Required techniques: usage register

The brief asks for **at least one** use of each technique **across the whole ship** (not in every piece). Every part
that uses one of them must be listed here, with the file and function, so a future change does not remove the only
instance by accident. A part's look comes first: use a technique only where it fits the piece naturally.

| Technique                                     | Part / variant               | Where                                                                                      | Curves                                                | Notes                                                                                                                            |
| --------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Surface of revolution                         | Weapon `machineGun` (barrel) | `src/parts/weapons.js` `barrelProfile` → `src/geometry/sweep.js` `buildRevolutionGeometry` | `CurvePath` of 8 `CubicBezierCurve`s (`bezierChain2`) | Jacket → S shoulder → barrel → muzzle bulb → flared crown → face → bore. Sharp knots keep hard edges. Params change the profile. |
| Sweep along a curved path (oriented sections) | — **pending**                | —                                                                                          | —                                                     | Candidate: a wing or thruster detail where it fits the look.                                                                     |
| Variable-shape sweep                          | — **pending**                | —                                                                                          | —                                                     | Planned for wings (airfoil section changing along the span), which also gives them geometric params.                             |

**Does not count** (kept here so nobody relies on it):

- Platform power cables (`src/hangar/platform.js`): built-in `TubeGeometry` on a `CatmullRomCurve3`. Hangar
  decoration, not a ship part, and not our generator.
- Fuselage tapered boxes (`src/parts/fuselage.js` `taperedBox`): deformed `BoxGeometry`, no curves. The fuselage is
  fixed, not an interchangeable part.

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
