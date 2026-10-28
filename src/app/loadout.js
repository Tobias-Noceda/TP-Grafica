import { HARDPOINTS } from '../parts/fuselage.js';
import { mountPart, unmountPart } from '../parts/sockets.js';
import { thrusterVariants } from '../parts/thrusters.js';
import { weaponVariants } from '../parts/weapons.js';
import { wingVariants } from '../parts/wings.js';

/**
 * Part variants by kind. Weapons and thrusters share the hardpoints.
 */
export const PART_KINDS = {
	wing: wingVariants,
	weapon: weaponVariants,
	thruster: thrusterVariants,
};

/**
 * Every hardpoint: the fuselage ones plus `wing`, whose sockets are provided by the mounted wings (their
 * `userData.sockets.top`), so it only exists while the chosen wing variant offers one.
 */
export const ALL_HARDPOINTS = {
	...HARDPOINTS,
	wing: { label: 'Wings (top)', accepts: ['weapon', 'thruster'] },
};

/**
 * Ids of the hardpoints that accept a part kind. With a variant, only those it allows (its optional `hardpoints`).
 */
export function hardpointsFor(kind, variantId) {
	const allowed = variantId && PART_KINDS[kind][variantId].hardpoints;
	return Object.keys(ALL_HARDPOINTS).filter(
		(id) => ALL_HARDPOINTS[id].accepts.includes(kind) && (!allowed || allowed.includes(id))
	);
}

/**
 * Ship loadout: the wings on `socket_wing_L/R`, and which part kind sits on which hardpoint. Each kind is mounted on
 * every socket of its hardpoint (a mirrored pair), and a hardpoint holds one kind at a time.
 *
 * Until the crane exists, parts are mounted instantly. Replaced parts have their geometries disposed; materials are
 * shared with the rest of the scene and are kept.
 */
export function createLoadout(fuselage, materials) {
	const mounted = {}; // kind → { variantId, hardpointId, params }
	let wings = [];
	let wingsOpen = 0;

	function socketsOf(hardpointId) {
		if (hardpointId === 'wing') return wings.map((wing) => wing.userData.sockets?.top).filter(Boolean);
		return HARDPOINTS[hardpointId].sockets.map((name) => fuselage.userData.sockets[name]);
	}

	function equip(kind, variantId, hardpointId, params = {}) {
		if (!hardpointsFor(kind, variantId).includes(hardpointId)) {
			throw new Error(`Hardpoint '${hardpointId}' does not accept '${kind}/${variantId}'`);
		}
		// Overlapping hardpoints share hull space, so they count as taken too
		const blocked = [hardpointId, ...(ALL_HARDPOINTS[hardpointId].overlaps ?? [])];
		const holder = Object.keys(mounted).find(
			(other) => other !== kind && blocked.includes(mounted[other].hardpointId)
		);
		if (holder) throw new Error(`Hardpoint '${hardpointId}' is blocked by a '${holder}'`);
		const sockets = socketsOf(hardpointId);
		if (!sockets.length) throw new Error(`Hardpoint '${hardpointId}' is not available with the current wings`);

		unequip(kind);
		const variant = PART_KINDS[kind][variantId];
		for (const socket of sockets) {
			const { outward, clearance } = socket.userData;
			mountPart(socket, variant.build({ ...variant.defaults, ...params }, materials, { outward, clearance }));
		}
		mounted[kind] = { variantId, hardpointId, params };
	}

	function unequip(kind) {
		const entry = mounted[kind];
		if (!entry) return;
		for (const socket of socketsOf(entry.hardpointId)) unmountPart(socket).forEach(disposeGeometries);
		delete mounted[kind];
	}

	/**
	 * Replaces both wings. Parts sitting on the wing hardpoint are taken off first and mounted again on the new wings.
	 */
	function equipWings(variantId, params = {}) {
		const onWings = Object.entries(mounted).filter(([, entry]) => entry.hardpointId === 'wing');
		for (const [kind] of onWings) unequip(kind);

		for (const side of ['L', 'R']) fuselage.userData.unmountPart(`socket_wing_${side}`).forEach(disposeGeometries);
		const variant = wingVariants[variantId];
		wings = ['L', 'R'].map((side) => {
			const wing = variant.build({ ...variant.defaults, ...params }, materials);
			fuselage.userData.mountPart(`socket_wing_${side}`, wing);
			return wing;
		});
		setWingsOpen(wingsOpen);

		for (const [kind, { variantId: partId, params: partParams }] of onWings) {
			if (socketsOf('wing').length) equip(kind, partId, 'wing', partParams);
		}
	}

	function setWingsOpen(t) {
		wingsOpen = t;
		for (const wing of wings) wing.userData.setOpen?.(t);
	}

	return { equip, unequip, equipWings, setWingsOpen, mounted };
}

function disposeGeometries(object) {
	object.traverse((child) => child.geometry?.dispose());
}
