import { machineGun } from './weapons/machineGun.js';

/**
 * Weapon variants by id. Each variant lives in its own file under `weapons/` and exposes `label`, `defaults`,
 * `paramSchema` and `build(params, materials, { outward, clearance })`, which returns a group whose origin is the
 * attach point on the hull. The weapon always fires along +z with +y up; `outward` (the socket's hull normal,
 * left-side frame) only decides which way its pylon grows and `clearance` how long it is (the gap to the hull), so the
 * same weapon fits a side or a top hardpoint. Weapons are built for the left side and mirrored on the right with
 * `scale.x = -1` (Three.js flips the face winding itself for mirrored world matrices).
 */
export const weaponVariants = {
	machineGun,
};
