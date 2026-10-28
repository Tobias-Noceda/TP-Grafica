import { rearEngine } from './propulsors/rearEngine.js';

/**
 * Thruster variants by id. Each variant lives in its own file under `propulsors/` and exposes `label`, `defaults`,
 * `paramSchema`, optional `hardpoints` (ids it may be mounted on, see `app/loadout.js`) and
 * `build(params, materials, { outward })`, which returns a group whose origin is the attach point on the hull, with
 * the nozzle pointing along `outward` (the socket's hull normal). Every thruster has a clear **body** and an
 * **exhaust** zone.
 */
export const thrusterVariants = {
	rearEngine,
};
