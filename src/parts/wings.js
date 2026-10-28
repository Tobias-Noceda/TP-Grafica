import { planeWing } from './wings/planeWing.js';
import { xWingSFoils } from './wings/xWingSFoils.js';

/**
 * Wing variants by id. Each variant lives in its own file under `wings/` and exposes `label`, `opens`, `defaults`,
 * `paramSchema` and `build(params, materials)`, which returns one side's wing set for the fuselage `socket_wing_*`,
 * built for the left side (+x outwards, +z forward, +y up); the right copy is mirrored by `mountPart`.
 *
 * `userData` exposes `sockets` (hardpoints the wing offers to weapons/thrusters, see `app/loadout.js`) and, for wings
 * that move (`opens: true`), `setOpen(t)` with t ∈ [0, 1]. Shared dimensions and helpers are in `wings/common.js`.
 */
export const wingVariants = {
	xwing: xWingSFoils,
	plane: planeWing,
};
