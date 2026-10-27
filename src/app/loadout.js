import { HARDPOINTS } from '../parts/fuselage.js';
import { weaponVariants } from '../parts/weapons.js';

/**
 * Part variants by kind. Thrusters will be added here; both kinds share the fuselage hardpoints.
 */
export const PART_KINDS = {
	weapon: weaponVariants,
};

/**
 * Ids of the hardpoints that accept a part kind.
 */
export function hardpointsFor(kind) {
	return Object.keys(HARDPOINTS).filter((id) => HARDPOINTS[id].accepts.includes(kind));
}

/**
 * Ship loadout: which part kind sits on which hardpoint. Each kind is mounted as a mirrored pair on the two sockets of
 * its hardpoint, and a hardpoint holds one kind at a time.
 *
 * Until the crane exists, equipping mounts the parts instantly. Replaced parts have their geometries disposed;
 * materials are shared with the rest of the scene and are kept.
 */
export function createLoadout(fuselage, materials) {
	const mounted = {}; // kind → hardpoint id

	function equip(kind, variantId, hardpointId, params = {}) {
		const hardpoint = HARDPOINTS[hardpointId];
		if (!hardpoint.accepts.includes(kind)) throw new Error(`Hardpoint '${hardpointId}' does not accept '${kind}'`);
		const holder = Object.keys(mounted).find((other) => other !== kind && mounted[other] === hardpointId);
		if (holder) throw new Error(`Hardpoint '${hardpointId}' already holds a '${holder}'`);

		unequip(kind);
		const variant = PART_KINDS[kind][variantId];
		for (const socketName of hardpoint.sockets) {
			const { outward, clearance } = fuselage.userData.sockets[socketName].userData;
			const part = variant.build({ ...variant.defaults, ...params }, materials, { outward, clearance });
			fuselage.userData.mountPart(socketName, part);
		}
		mounted[kind] = hardpointId;
	}

	function unequip(kind) {
		const hardpointId = mounted[kind];
		if (!hardpointId) return;
		for (const socketName of HARDPOINTS[hardpointId].sockets) {
			for (const part of fuselage.userData.unmountPart(socketName)) {
				part.traverse((child) => child.geometry?.dispose());
			}
		}
		delete mounted[kind];
	}

	return { equip, unequip, mounted };
}
