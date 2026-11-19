import { quadBlock } from './propulsors/quadBlock.js';
import { rearEngine } from './propulsors/rearEngine.js';

/**
 * Thruster variants by id. Each variant lives in its own file under `propulsors/` and exposes `label`, `defaults`,
 * `paramSchema`, optional `hardpoints` (ids it may be mounted on, see `app/loadout.js`) and
 * `build(params, materials, { outward, side, toPairCentre })`, which returns a group whose origin is the attach point
 * on the hull. Rear thrusters point the nozzle along `outward` (the socket's hull normal); on the top and wing
 * hardpoints the engine lies on holders and fires backwards (-z). `side` and `toPairCentre` (from the socket) let a
 * pair of sockets share one engine. Every thruster has a clear **body** and an **exhaust** zone.
 */
export const thrusterVariants = {
	rearEngine,
	quadBlock,
};
