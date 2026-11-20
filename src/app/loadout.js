import { HARDPOINTS } from '../parts/fuselage.js';
import { mountPart, showCover } from '../parts/sockets.js';
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

const KIND_ORDER = ['wing', 'thruster', 'weapon'];
const KIND_LABELS = { wing: 'Wing', thruster: 'Thruster', weapon: 'Weapon' };

/** Whether a built part contains any mesh (empty groups, e.g. the right socket of a shared engine, get no piece). */
function hasMesh(object) {
	let found = false;
	object.traverse((child) => {
		if (child.isMesh) found = true;
	});
	return found;
}

/**
 * Ship loadout: the wings on `socket_wing_L/R`, and which part kind sits on which hardpoint. Each kind is mounted on
 * every socket of its hardpoint (a mirrored pair), and a hardpoint holds one kind at a time.
 *
 * Every non-empty built part is also a **piece** (see `pieces()`): a plain object that remembers its socket and its
 * mounted pose, so another module can detach it (`detachPiece`, e.g. onto the hangar floor or a crane gripper) and mount
 * it back (`mountPiece`). Builders may return an empty group for one socket of a pair (a shared engine built by the
 * left socket); those are still mounted but get no piece. Replaced parts have their geometries disposed whether they
 * are mounted or detached; materials are shared with the rest of the scene and are kept.
 */
export function createLoadout(fuselage, materials) {
	const mounted = {}; // kind → { variantId, hardpointId, params }
	const records = {}; // kind → [{ part, socket, piece | null }] every part built for the kind, empty ones included
	let wingRecords = [];
	let wings = [];
	let wingsOpen = 0;

	function socketsOf(hardpointId) {
		if (hardpointId === 'wing') return wings.map((wing) => wing.userData.sockets?.top).filter(Boolean);
		return HARDPOINTS[hardpointId].sockets.map((name) => fuselage.userData.sockets[name]);
	}

	function makePiece({ kind, variantId, hardpointId, side, socket, part }) {
		return {
			id: kind === 'wing' ? `wing_${side}` : `${kind}_${hardpointId}_${side}`,
			label: [KIND_LABELS[kind], side === 'C' ? null : side].filter(Boolean).join(' '),
			kind,
			variantId,
			hardpointId,
			side,
			socket,
			part,
			local: { position: part.position.clone(), quaternion: part.quaternion.clone(), scale: part.scale.clone() },
			mounted: true,
		};
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
		records[kind] = sockets.map((socket) => {
			const { outward, clearance, side, toPairCentre } = socket.userData;
			const options = { outward, clearance, side, toPairCentre };
			const part = variant.build({ ...variant.defaults, ...params }, materials, options);
			mountPart(socket, part);
			let piece = null;
			if (hasMesh(part)) {
				// On the wing hardpoint the socket's own side is always 'L', so use the wing's side to tell them apart
				const pieceSide = hardpointId === 'wing' ? (wings.length > 1 ? sideOfWing(socket) : 'L') : side;
				piece = makePiece({ kind, variantId, hardpointId, side: pieceSide, socket, part });
			}
			return { part, socket, piece };
		});
		mounted[kind] = { variantId, hardpointId, params };
	}

	function sideOfWing(socket) {
		return wings.findIndex((wing) => wing.userData.sockets?.top === socket) === 1 ? 'R' : 'L';
	}

	function removeRecords(list) {
		for (const { part, socket } of list) {
			part.removeFromParent();
			disposeGeometries(part);
			showCover(socket, true);
		}
	}

	function unequip(kind) {
		const entry = mounted[kind];
		if (!entry) return;
		removeRecords(records[kind] ?? []);
		delete records[kind];
		delete mounted[kind];
	}

	/**
	 * Replaces both wings. Parts sitting on the wing hardpoint are taken off first and mounted again on the new wings.
	 */
	function equipWings(variantId, params = {}) {
		const onWings = Object.entries(mounted).filter(([, entry]) => entry.hardpointId === 'wing');
		for (const [kind] of onWings) unequip(kind);

		removeRecords(wingRecords);
		const variant = wingVariants[variantId];
		wingRecords = ['L', 'R'].map((side) => {
			const part = variant.build({ ...variant.defaults, ...params }, materials);
			const name = `socket_wing_${side}`;
			fuselage.userData.mountPart(name, part);
			const socket = fuselage.userData.sockets[name];
			const piece = makePiece({ kind: 'wing', variantId, hardpointId: 'wingRoot', side, socket, part });
			return { part, socket, piece };
		});
		wings = wingRecords.map((record) => record.part);
		setWingsOpen(wingsOpen);

		for (const [kind, { variantId: partId, params: partParams }] of onWings) {
			if (socketsOf('wing').length) equip(kind, partId, 'wing', partParams);
		}
	}

	function setWingsOpen(t) {
		wingsOpen = t;
		for (const wing of wings) wing.userData.setOpen?.(t);
	}

	/**
	 * Pieces in assembly order: wings (L, R), then thrusters, then weapons; sockets in hardpoint order within a kind.
	 */
	function pieces() {
		const lists = { wing: wingRecords, thruster: records.thruster ?? [], weapon: records.weapon ?? [] };
		return KIND_ORDER.flatMap((kind) => lists[kind].map((record) => record.piece).filter(Boolean));
	}

	/**
	 * Snaps the piece back on its socket in its mounted pose.
	 */
	function mountPiece(piece) {
		piece.socket.add(piece.part);
		piece.part.position.copy(piece.local.position);
		piece.part.quaternion.copy(piece.local.quaternion);
		piece.part.scale.copy(piece.local.scale);
		showCover(piece.socket, false);
		piece.mounted = true;
	}

	/**
	 * Reparents the piece to `parent` keeping its world transform; the socket cover shows again if nothing else is on it.
	 */
	function detachPiece(piece, parent) {
		parent.attach(piece.part);
		piece.mounted = false;
		if (!pieces().some((other) => other !== piece && other.socket === piece.socket && other.mounted)) {
			showCover(piece.socket, true);
		}
	}

	/**
	 * Removes every part (wings included), mounted or detached, and forgets the pieces.
	 */
	function disposeAll() {
		for (const kind of Object.keys(mounted)) unequip(kind);
		removeRecords(wingRecords);
		wingRecords = [];
		wings = [];
	}

	return {
		equip,
		unequip,
		equipWings,
		setWingsOpen,
		mounted,
		pieces,
		mountPiece,
		detachPiece,
		disposeAll,
	};
}

/** Disposes every geometry under `object`. Materials are shared with the rest of the scene and are kept. */
function disposeGeometries(object) {
	object.traverse((child) => child.geometry?.dispose());
}
