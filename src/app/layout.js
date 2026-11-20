import * as THREE from 'three';

import { HANGAR } from '../hangar/hangar.js';
import { PLATFORM } from '../hangar/platform.js';
import { CRANE_LIMITS } from './crane.js';

/**
 * Floor layout for the crane assembly: spreads the ship's parts on the hangar floor around the platform and puts them
 * back on the ship.
 *
 * Key idea, the "translated mounted pose": the floor pose of every piece is its mounted WORLD pose plus a pure
 * translation (same rotation, same scale, so mirrored right-side parts keep `scale.x = -1`). The crane therefore only
 * ever has to translate a part by `-piece.floorOffset` to drop it on its socket.
 *
 * Zones (world metres, platform square half-side `CLEAR` = 5.3, nose towards +z, ship's left = +x):
 *   - Wings: same z as their socket, pushed sideways until the inner edge of the box is `MARGIN` outside the platform
 *     square (left wing at +x, right wing at -x), lowest point on floor pads 0.15 m high. A jig (base plate, column,
 *     U cradle) holds the wing level when its root floats above the floor: under `part.userData.support.point`
 *     (part-local, e.g. the middle of the TIE neck) when the wing declares one, otherwise under the root.
 *   - Weapons: rack in front of the platform on the right (x < 0), a row along -x starting at x = -RACK_X, on pallets.
 *   - Thrusters: the same rack mirrored on the left (x > 0).
 *
 * Slim props (foot, chrome rod, rubber saddle) go under whatever still floats above the pads or pallet: outer wing
 * panels, gun barrels, engine noses (see `buildProps`).
 *
 * Every stand is a primitive (boxes / cylinders). Their geometries are disposed in `clear()`; materials are shared.
 */

const CLEAR = PLATFORM.size / 2 + 0.3; // keep out of the platform square (rails included) by this half-side
const GAP = 0.6; // minimum distance between pieces and stands
const MARGIN = 1.5; // walkway between the platform square and the pieces
const PAD_H = 0.15; // wing floor pad height
const PAD_SIZE = 0.7; // wing floor pad side
const PALLET_H = 0.12; // weapon / thruster pallet height
const RACK_X = CLEAR + MARGIN + 0.7; // first piece of a rack starts at |x| = RACK_X
const RACK_Z = CLEAR + MARGIN; // racks start in front of the platform
// Slim props under floating parts: no floating underside further than `reach` from a support, at most `max` props
const WING_PROPS = { reach: 0.9, max: 4, radius: 0.035 };
const RACK_PROPS = { reach: 0.3, max: 3, radius: 0.018 };
const PROP_MIN_GAP = 0.1; // closer to the rest surface than this, a part needs no prop
const JIG_MIN_GAP = 0.3; // a root lower than this above the floor needs no jig
const ROOT_RADIUS = 0.4; // x distance around the root used to find its lowest geometry

/**
 * Creates the floor layout manager. Its `group` (name 'floor-layout') is added to `scene` once; pieces on the floor
 * are reparented to it, so the crane can carry them.
 *
 * @param {THREE.Scene} scene
 * @param {object} materials Shared material library (`darkMetal`, `trim`, `gunMetal`, `chrome`).
 * @param {object} shadows Shadow manager (`enableOn`, `markDirty`).
 * @returns {{ group: THREE.Group, placeOnFloor: Function, placeOnShip: Function, clear: Function, isOnFloor: boolean }}
 */
export function createFloorLayout(scene, materials, shadows) {
	const group = new THREE.Group();
	group.name = 'floor-layout';
	scene.add(group);

	/** Pieces currently on the floor (used to reset their `stands` on clear). */
	let placed = [];
	let onFloor = false;

	/** Is the object and every ancestor visible (hidden covers must not be measured or hit). */
	const isVisible = (object) => {
		for (let o = object; o; o = o.parent) if (!o.visible) return false;
		return true;
	};

	/** Calls `fn(worldVertex)` for every vertex of every visible mesh under `root` (matrices must be up to date). */
	const forEachWorldVertex = (root, fn) => {
		const v = new THREE.Vector3();
		root.traverse((child) => {
			const position = child.isMesh && child.geometry.attributes.position;
			if (!position || !isVisible(child)) return;
			for (let i = 0; i < position.count; i++)
				fn(v.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld));
		});
	};

	/** A box mesh with its bottom at `y` and centred at (x, z). */
	const slab = (name, w, h, d, material, x, y, z) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
		mesh.name = name;
		mesh.position.set(x, y + h / 2, z);
		return mesh;
	};

	/** Registers a stand: adds it to the layout, enables shadows and records it on the piece. */
	const addStand = (piece, stand) => {
		group.add(stand);
		shadows.enableOn(stand, { cast: true });
		piece.stands.push(stand);
	};

	/** Low floor pads under the lowest geometry of a wing (one, or two at the extremes of a long contact area). */
	const buildFloorPads = (piece, bottomY) => {
		const low = [];
		forEachWorldVertex(piece.part, (v) => {
			if (v.y < bottomY + 0.08) low.push(v.clone());
		});
		if (!low.length) return;
		const min = new THREE.Vector3(Infinity, 0, Infinity);
		const max = new THREE.Vector3(-Infinity, 0, -Infinity);
		for (const v of low) {
			min.x = Math.min(min.x, v.x);
			min.z = Math.min(min.z, v.z);
			max.x = Math.max(max.x, v.x);
			max.z = Math.max(max.z, v.z);
		}
		const spanX = max.x - min.x;
		const spanZ = max.z - min.z;
		const centres = [];
		if (Math.max(spanX, spanZ) < 1) {
			centres.push([(min.x + max.x) / 2, (min.z + max.z) / 2]);
		} else if (spanX >= spanZ) {
			const a = low.reduce((p, v) => (v.x < p.x ? v : p));
			const b = low.reduce((p, v) => (v.x > p.x ? v : p));
			centres.push([a.x + 0.3, a.z], [b.x - 0.3, b.z]);
		} else {
			const a = low.reduce((p, v) => (v.z < p.z ? v : p));
			const b = low.reduce((p, v) => (v.z > p.z ? v : p));
			centres.push([a.x, a.z + 0.3], [b.x, b.z - 0.3]);
		}
		for (const [x, z] of centres) {
			const pad = new THREE.Group();
			pad.name = 'floor-pad';
			pad.add(slab('pad-body', PAD_SIZE, PAD_H - 0.03, PAD_SIZE, materials.darkMetal, x, 0, z));
			pad.add(slab('pad-top', PAD_SIZE, 0.03, PAD_SIZE, materials.trim, x, PAD_H - 0.03, z));
			addStand(piece, pad);
		}
	};

	/**
	 * Jig (base plate, column, U cradle) holding a wing level. Under `part.userData.support` (`point` part-local on the
	 * bottom of the structure, `halfWidth` across it) when given, otherwise centred under the root's lowest geometry.
	 * Skipped when that point is already close to the floor. Returns the supported point (world), or null. Wings leave the hull along x, so the cradle walls run
	 * along x on both sides (z) of the supported structure.
	 */
	const buildWingJig = (piece) => {
		const support = piece.part.userData.support;
		let top;
		let halfWidth;
		if (support) {
			top = piece.part.localToWorld(support.point.clone());
			halfWidth = support.halfWidth;
		} else {
			const root = piece.part.getWorldPosition(new THREE.Vector3());
			const near = [];
			forEachWorldVertex(piece.part, (v) => {
				if (Math.abs(v.x - root.x) < ROOT_RADIUS) near.push(v.clone());
			});
			if (!near.length) return null;
			const minY = Math.min(...near.map((v) => v.y));
			const bottom = near.filter((v) => v.y < minY + 0.05);
			const minZ = Math.min(...bottom.map((v) => v.z));
			const maxZ = Math.max(...bottom.map((v) => v.z));
			top = new THREE.Vector3(root.x, minY, (minZ + maxZ) / 2);
			halfWidth = Math.max((maxZ - minZ) / 2, 0.15);
		}
		if (top.y <= JIG_MIN_GAP) return null;

		const plateTop = top.y - 0.005; // cradle plate just under the supported surface
		const BASE_H = 0.08;
		const PLATE_H = 0.1;
		const WALL = 0.06;
		const columnH = plateTop - PLATE_H - BASE_H;
		const { x, z } = top;
		const cradleW = 2 * (halfWidth + 0.02 + WALL); // across (z)
		const cradleL = 0.5; // along the wing (x)
		const jig = new THREE.Group();
		jig.name = 'wing-jig';
		// Narrow along the wing (x) so it stays clear of the floor pads under the wing panel
		jig.add(slab('jig-base', 0.5, BASE_H, 1.0, materials.darkMetal, x, 0, z));
		const column = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, columnH, 16), materials.gunMetal);
		column.name = 'jig-column';
		column.position.set(x, BASE_H + columnH / 2, z);
		jig.add(column);
		jig.add(slab('jig-collar', 0.4, 0.06, 0.4, materials.chrome, x, BASE_H, z));
		jig.add(slab('cradle-plate', cradleL, PLATE_H, cradleW, materials.trim, x, plateTop - PLATE_H, z));
		for (const s of [-1, 1]) {
			const wallZ = z + s * (cradleW / 2 - WALL / 2);
			jig.add(slab('cradle-wall', cradleL, 0.14, WALL, materials.trim, x, plateTop, wallZ));
		}
		addStand(piece, jig);
		return top;
	};

	/** Pallet (dark slab with trim edge strips) under a rack piece; `box` is the floor-placed world box. */
	const buildPallet = (piece, box) => {
		const w = box.max.x - box.min.x + 0.3;
		const d = box.max.z - box.min.z + 0.3;
		const cx = (box.min.x + box.max.x) / 2;
		const cz = (box.min.z + box.max.z) / 2;
		const pallet = new THREE.Group();
		pallet.name = 'pallet';
		pallet.add(slab('pallet-deck', w, PALLET_H, d, materials.darkMetal, cx, 0, cz));
		const edge = 0.05;
		const lift = 0.015;
		for (const s of [-1, 1]) {
			pallet.add(slab('pallet-edge', w, lift, edge, materials.trim, cx, PALLET_H, cz + s * (d / 2 - edge / 2)));
			pallet.add(
				slab('pallet-edge', edge, lift, d - 2 * edge, materials.trim, cx + s * (w / 2 - edge / 2), PALLET_H, cz)
			);
		}
		addStand(piece, pallet);
	};

	/**
	 * Raycasts against `part` with every material made double-sided for the call. Mirrored right-side parts
	 * (`scale.x = -1`) have their triangles wound the other way in local space, so a front-side-only raycast misses
	 * the faces that are actually facing the ray. Materials are shared, so their `side` is restored right away.
	 */
	const raycastPart = (part, origin, direction) => {
		const sides = new Map();
		part.traverse((child) => {
			if (!child.isMesh) return;
			for (const material of [child.material].flat()) {
				if (!sides.has(material)) sides.set(material, material.side);
				material.side = THREE.DoubleSide;
			}
		});
		raycaster.set(origin, direction);
		const hit = raycaster.intersectObject(part, true).find((h) => h.object.isMesh && isVisible(h.object));
		for (const [material, side] of sides) material.side = side;
		return hit;
	};
	const raycaster = new THREE.Raycaster();
	const UP = new THREE.Vector3(0, 1, 0);
	const DOWN = new THREE.Vector3(0, -1, 0);

	/**
	 * Slim props (foot plate, rod, rubber saddle) under the parts of a piece that float above its rest surface at
	 * `baseY` (floor or pallet top). The underside is sampled with upward rays on a grid over the floor box; cells
	 * touching the rest surface, plus the given `contacts` (e.g. a jig), count as supported. Props are added greedily
	 * at the interior cell farthest from every support until all floating underside is within `reach` of one (at most
	 * `max` props). Each rod goes straight up from `floorY` to the first surface above it, so it never crosses the part.
	 */
	const buildProps = (piece, box, baseY, { floorY = baseY, reach, max, radius, contacts = [] }) => {
		const N = 16;
		const cells = [];
		const cell = (i, j) => (i >= 0 && j >= 0 && i < N && j < N ? cells[j * N + i] : null);
		for (let j = 0; j < N; j++) {
			for (let i = 0; i < N; i++) {
				const x = box.min.x + ((i + 0.5) / N) * (box.max.x - box.min.x);
				const z = box.min.z + ((j + 0.5) / N) * (box.max.z - box.min.z);
				const hit = raycastPart(piece.part, new THREE.Vector3(x, baseY - 0.01, z), UP);
				cells.push(hit ? { x, z, top: hit.point.y } : null);
			}
		}
		const supports = contacts.map((c) => new THREE.Vector2(c.x, c.z));
		for (const c of cells) if (c && c.top - baseY < 0.03) supports.push(new THREE.Vector2(c.x, c.z));

		// Floating cells whose neighbours are all part of the underside too: no props on the very edge
		const candidates = [];
		for (let j = 0; j < N; j++) {
			for (let i = 0; i < N; i++) {
				const c = cell(i, j);
				if (!c || c.top - baseY < PROP_MIN_GAP) continue;
				const neighbours = [cell(i - 1, j), cell(i + 1, j), cell(i, j - 1), cell(i, j + 1)];
				if (neighbours.every((n) => n && Math.abs(n.top - c.top) < 0.1)) candidates.push(c);
			}
		}
		const distance = (c) => supports.reduce((d, s) => Math.min(d, Math.hypot(s.x - c.x, s.y - c.z)), Infinity);
		// Sample the saddle's footprint and rest it under the lowest hit, so neither saddle nor rod can cross the part;
		// skip spots too uneven to look supported (e.g. between barrels)
		const footprintTop = (c) => {
			let low = Infinity;
			let high = -Infinity;
			for (let k = 0; k <= 8; k++) {
				const r = k === 0 ? 0 : radius * 2.2;
				const a = (k / 8) * 2 * Math.PI;
				const origin = new THREE.Vector3(c.x + r * Math.cos(a), baseY - 0.01, c.z + r * Math.sin(a));
				const hit = raycastPart(piece.part, origin, UP);
				if (!hit) {
					if (k === 0) return null;
					continue; // footprint edge out from under the part: nothing to clip there
				}
				low = Math.min(low, hit.point.y);
				high = Math.max(high, hit.point.y);
			}
			return high - low < 0.1 ? low : null;
		};
		for (let count = 0; count < max && candidates.length;) {
			const best = candidates.reduce((a, b) => (distance(b) > distance(a) ? b : a));
			if (distance(best) < reach) break;
			candidates.splice(candidates.indexOf(best), 1);
			const top = footprintTop(best);
			if (top === null || top - baseY < PROP_MIN_GAP) continue;
			best.top = top;
			supports.push(new THREE.Vector2(best.x, best.z));
			count++;

			const prop = new THREE.Group();
			prop.name = 'prop';
			const foot = new THREE.Mesh(
				new THREE.CylinderGeometry(radius * 2.4, radius * 2.6, 0.02, 16),
				materials.darkMetal
			);
			foot.position.set(best.x, floorY + 0.01, best.z);
			const rodH = best.top - floorY - 0.04;
			const rod = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, rodH, 12), materials.chrome);
			rod.position.set(best.x, floorY + 0.02 + rodH / 2, best.z);
			const saddle = new THREE.Mesh(
				new THREE.CylinderGeometry(radius * 1.8, radius * 1.4, 0.02, 16),
				materials.rubber
			);
			saddle.position.set(best.x, best.top - 0.01, best.z);
			prop.add(foot, rod, saddle);
			addStand(piece, prop);
		}
	};

	/** Grip point in part-local coordinates: `userData.gripPoint`, else the highest point under a 5x5 downward ray grid. */
	const computeGripPoint = (part, box) => {
		if (part.userData.gripPoint) return part.userData.gripPoint.clone();
		const cx = (box.min.x + box.max.x) / 2;
		const cz = (box.min.z + box.max.z) / 2;
		const hx = (box.max.x - box.min.x) / 4;
		const hz = (box.max.z - box.min.z) / 4;
		let best = null;
		for (let i = 0; i < 5; i++) {
			for (let j = 0; j < 5; j++) {
				const origin = new THREE.Vector3(cx + (i / 2 - 1) * hx, box.max.y + 1, cz + (j / 2 - 1) * hz);
				const hit = raycastPart(part, origin, DOWN);
				// Highest hit; on ties (flat tops) the one nearest the centre, so mirrored pieces get mirrored grips
				const centreDistance = (point) => Math.hypot(point.x - cx, point.z - cz);
				const better =
					hit &&
					(!best ||
						hit.point.y > best.y + 1e-3 ||
						(hit.point.y > best.y - 1e-3 && centreDistance(hit.point) < centreDistance(best)));
				if (better) best = hit.point;
			}
		}
		const world = best ?? new THREE.Vector3(cx, box.max.y, cz);
		return part.worldToLocal(world.clone());
	};

	/** Removes every stand from the scene and disposes its geometries (materials are shared). */
	const clear = () => {
		for (const piece of placed) {
			for (const stand of piece.stands ?? []) {
				stand.removeFromParent();
				stand.traverse((child) => child.geometry?.dispose());
			}
			piece.stands = [];
		}
		placed = [];
		shadows.markDirty();
	};

	/** Warns when a floor box leaves the hangar or its grip point leaves the crane's travel. */
	const checkReach = (piece, box) => {
		const hx = HANGAR.width / 2;
		const hz = HANGAR.depth / 2;
		if (box.min.x < -hx || box.max.x > hx || box.min.z < -hz || box.max.z > hz) {
			console.warn(`[layout] ${piece.id} leaves the hangar`);
		}
		const grip = piece.part.localToWorld(piece.gripPoint.clone());
		const [x0, x1] = CRANE_LIMITS.x;
		const [z0, z1] = CRANE_LIMITS.z;
		if (grip.x < x0 || grip.x > x1 || grip.z < z0 || grip.z > z1) {
			console.warn(`[layout] ${piece.id} grip point is out of crane reach`, grip.toArray());
		}
	};

	/**
	 * Detaches every piece and lays it on the floor (see module comment). Pieces are given `floorOffset`,
	 * `gripPoint` (part-local) and `stands`.
	 */
	const placeOnFloor = (pieces, loadout) => {
		clear();
		for (const piece of pieces) if (!piece.mounted) loadout.mountPiece(piece);
		scene.updateMatrixWorld(true);

		// Mounted world boxes, measured before anything moves
		const boxes = new Map(pieces.map((piece) => [piece, new THREE.Box3().setFromObject(piece.part)]));
		const offsets = new Map();
		const floorBoxes = new Map();
		const place = (piece, delta) => {
			offsets.set(piece, delta);
			floorBoxes.set(piece, boxes.get(piece).clone().translate(delta));
		};

		// Wings: same z, pushed sideways off the platform, lowest point on the pads
		let leftEnd = -Infinity;
		let rightEnd = -Infinity;
		for (const piece of pieces.filter((p) => p.kind === 'wing')) {
			const box = boxes.get(piece);
			const dx = piece.side === 'R' ? -CLEAR - MARGIN - box.max.x : CLEAR + MARGIN - box.min.x;
			place(piece, new THREE.Vector3(dx, PAD_H - box.min.y, 0));
			const end = floorBoxes.get(piece).max.z;
			if (piece.side === 'R') rightEnd = Math.max(rightEnd, end);
			else leftEnd = Math.max(leftEnd, end);
		}

		// Racks: rows along -x (weapons) or +x (thrusters), in front of the platform and of the wings on that side
		const rack = (kind, sign, wingEnd) => {
			const limit = Math.min(Math.abs(CRANE_LIMITS.x[0]), CRANE_LIMITS.x[1]) - 0.5;
			let rowZ = Math.max(RACK_Z, wingEnd + GAP + 0.2);
			let cursor = RACK_X;
			let rowDepth = 0;
			for (const piece of pieces.filter((p) => p.kind === kind)) {
				const box = boxes.get(piece);
				const w = box.max.x - box.min.x;
				const d = box.max.z - box.min.z;
				if (cursor + w > limit && rowDepth > 0) {
					rowZ += rowDepth + GAP + 0.3;
					cursor = RACK_X;
					rowDepth = 0;
				}
				const nearX = sign * cursor; // edge of the box closest to the platform axis
				const dx = sign > 0 ? nearX - box.min.x : nearX - box.max.x;
				place(piece, new THREE.Vector3(dx, PALLET_H - box.min.y, rowZ - box.min.z));
				cursor += w + GAP + 0.3;
				rowDepth = Math.max(rowDepth, d);
			}
		};
		rack('weapon', -1, rightEnd);
		rack('thruster', 1, leftEnd);

		// Apply. Detach everything before moving anything: parts on the wing hardpoint hang from a wing socket, so
		// moving a wing first would carry them along and they would then be offset twice.
		for (const piece of pieces) loadout.detachPiece(piece, group);
		for (const piece of pieces) {
			const delta = offsets.get(piece);
			piece.part.position.add(delta);
			piece.floorOffset = delta.clone();
			piece.stands = [];
		}
		group.updateMatrixWorld(true);
		placed = pieces.slice();

		for (const piece of pieces) {
			const box = floorBoxes.get(piece);
			if (piece.kind === 'wing') {
				buildFloorPads(piece, box.min.y);
				const jig = buildWingJig(piece);
				// Props stand on the floor, next to the pads the wing rests on
				buildProps(piece, box, PAD_H, { floorY: 0, ...WING_PROPS, contacts: jig ? [jig] : [] });
			} else {
				buildPallet(piece, box);
				buildProps(piece, box, PALLET_H, RACK_PROPS);
			}
			piece.gripPoint = computeGripPoint(piece.part, box);
			shadows.enableOn(piece.part, { cast: true });
			checkReach(piece, box);
		}
		onFloor = true;
		shadows.markDirty();
	};

	/** Snaps every piece back on its socket and removes the stands. */
	const placeOnShip = (pieces, loadout) => {
		for (const piece of pieces) loadout.mountPiece(piece);
		clear();
		onFloor = false;
		shadows.markDirty();
	};

	return {
		group,
		placeOnFloor,
		placeOnShip,
		clear,
		get isOnFloor() {
			return onFloor;
		},
	};
}
