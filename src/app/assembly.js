import * as THREE from 'three';

const APPROACH_WING = 0.8; // m, distance of the approach point A from the final grip point G along the socket outward
const APPROACH_OTHER = 0.5;
const CLEARANCE = 0.5; // m above the highest obstacle when travelling
const GRAB_DWELL = 0.5; // s
const RELEASE_DWELL = 0.4; // s
const SETTLE_TOL = 0.15; // deg of residual sway
const SETTLE_TIMEOUT = 6; // s
const INSERT_SETTLE_TOL = 0.3;
const INSERT_SETTLE_TIMEOUT = 2;
const PARK_XZ = { x: 0, z: -8 };

/**
 * Drives the crane through the assembly: for each piece, in loadout order,
 *
 *   RAISE → MOVE_OVER_PART → SETTLE → LOWER_TO_GRAB → GRAB → LIFT_SAFE → MOVE_OVER_SOCKET → SETTLE →
 *   LOWER_TO_APPROACH → INSERT → SETTLE → RELEASE → RETRACT (→ next piece), then PARK.
 *
 * Every step issues `crane.userData.moveTo` targets and waits for `arrived()` (settle steps wait for the sway to
 * die, with a timeout). The caller feeds `update(dt)` (speed-scaled, pause-aware) while the phase is 'running' and
 * calls `crane.userData.update(dt)` itself.
 *
 * Approach along the socket outward: the world outward `o` is the socket's `outward` (left-side frame; x negated for
 * 'R' sockets, which are mirrored) brought to world space with `transformDirection(socket.matrixWorld)`. The approach
 * point is `A = G + o * APPROACH`: for top sockets (o ≈ +y) the insertion is the last vertical stretch, for wings,
 * nose and rear the part is lowered beside the hull and slid in horizontally.
 *
 * Live targets: G (grip point of the part in its mounted pose, `socket.matrixWorld · local · gripPoint`) and A are
 * recomputed every frame, so toggling the landing gear mid-sequence (which moves the ship) is followed.
 *
 * Safe height (magnet-face world y): above the fuselage and every part or stand still on the floor, plus the carried
 * part's extent below the face when carrying; clamped to the crane's limit (warns once). Computed when a step starts.
 */
export function createAssembly({ crane, loadout, fuselage, layout, shadows, onDone }) {
	const api = crane.userData;
	crane.updateMatrixWorld(true);
	const PARK_Y = api.faceWorldPosition(new THREE.Vector3()).y;

	let phase = 'idle';
	let queue = [];
	let all = [];
	let total = 0;
	let current = null;
	let carried = false;
	let step = 'RAISE';
	let entered = false;
	let timer = 0;
	let safe = 0;
	let grabY = 0;
	let warned = false;

	const tmpBox = new THREE.Box3();
	const tmpV = new THREE.Vector3();
	const tmpM = new THREE.Matrix4();
	const tmpLocal = new THREE.Matrix4();
	const G = new THREE.Vector3();
	const A = new THREE.Vector3();
	const O = new THREE.Vector3();
	const grabOffset = new THREE.Vector3();

	function safeY(carriedPiece) {
		let top = tmpBox.setFromObject(fuselage).max.y;
		for (const piece of all) {
			if (piece === carriedPiece || piece.mounted) continue;
			top = Math.max(top, tmpBox.setFromObject(piece.part).max.y);
			for (const stand of piece.stands ?? []) top = Math.max(top, tmpBox.setFromObject(stand).max.y);
		}
		let y = top + CLEARANCE;
		if (carriedPiece) y = top + (grabY - tmpBox.setFromObject(carriedPiece.part).min.y) + CLEARANCE;
		const max = api.limits.y[1];
		if (y > max) {
			if (!warned) console.warn(`[assembly] safe height ${y.toFixed(2)} clamped to ${max.toFixed(2)}`);
			warned = true;
			y = max;
		}
		return y;
	}

	/** Fills G (final grip point, world) and A (approach point) from the socket's current world matrix. */
	function liveTargets(piece) {
		const socket = piece.socket;
		socket.updateWorldMatrix(true, false);
		tmpLocal.compose(piece.local.position, piece.local.quaternion, piece.local.scale);
		tmpM.multiplyMatrices(socket.matrixWorld, tmpLocal);
		G.copy(piece.gripPoint).applyMatrix4(tmpM);
		O.copy(socket.userData.outward ?? tmpV.set(0, 1, 0));
		if (socket.userData.side === 'R') O.x = -O.x;
		O.transformDirection(socket.matrixWorld).normalize();
		const approach = piece.kind === 'wing' ? APPROACH_WING : APPROACH_OTHER;
		A.copy(G).addScaledVector(O, approach);
		if (carried) {
			G.sub(grabOffset);
			A.sub(grabOffset);
		}
	}

	// From the final approach until the magnet has backed off: slower crane and a locked swing, so the part follows
	// a straight line into its socket instead of swinging into the hull
	const PRECISE_STEPS = new Set(['LOWER_TO_APPROACH', 'INSERT', 'SETTLE_INSERT', 'RELEASE', 'RETRACT']);
	const go = (next) => {
		api.setPrecision(PRECISE_STEPS.has(next));
		api.setSwingLock(PRECISE_STEPS.has(next));
		step = next;
		entered = false;
		timer = 0;
	};
	const settle = (dt, tol, timeout, next) => {
		timer += dt;
		if (api.settled(tol) || timer > timeout) go(next);
	};
	/** Issues `target` once (or every frame if `live`) and moves on when the crane has arrived. */
	const moveStep = (target, next, live = false) => {
		if (!entered || live) {
			api.moveTo(target());
			// A live step re-issues its target every frame, so it must still check for arrival on the same frame
			if (entered && api.arrived()) return go(next);
			entered = true;
		} else if (api.arrived()) go(next);
	};
	const dwell = (dt, seconds, next) => {
		timer += dt;
		if (timer >= seconds) go(next);
	};
	const faceY = () => api.faceWorldPosition(tmpV).y;

	function nextPiece() {
		current = queue.shift() ?? null;
		if (current) go('MOVE_OVER_PART');
		else go('PARK_XZ');
	}

	function tick(dt) {
		const piece = current;
		switch (step) {
			case 'RAISE':
				if (!entered) safe = safeY(null);
				return moveStep(() => ({ y: safe }), 'MOVE_OVER_PART');
			case 'MOVE_OVER_PART':
				if (!entered) {
					safe = safeY(null);
					piece.part.updateWorldMatrix(true, false);
					piece.part.localToWorld(G.copy(piece.gripPoint));
				}
				return moveStep(() => ({ x: G.x, z: G.z, y: safe }), 'SETTLE_PART');
			case 'SETTLE_PART':
				return settle(dt, SETTLE_TOL, SETTLE_TIMEOUT, 'LOWER_TO_GRAB');
			case 'LOWER_TO_GRAB':
				if (!entered) {
					piece.part.updateWorldMatrix(true, false);
					piece.part.localToWorld(G.copy(piece.gripPoint));
				}
				return moveStep(() => ({ x: G.x, z: G.z, y: G.y }), 'GRAB');
			case 'GRAB':
				if (!entered) {
					api.setMagnet(true);
					grabY = faceY();
					// Where the part's grip point really is relative to the face (a residual sway leaves a few cm):
					// targets for the face are shifted by it, so the part itself lands on its mounted pose
					piece.part.localToWorld(grabOffset.copy(piece.gripPoint)).sub(api.faceWorldPosition(tmpV));
					api.attachPoint.attach(piece.part);
					carried = true;
					entered = true;
				}
				return dwell(dt, GRAB_DWELL, 'LIFT_SAFE');
			case 'LIFT_SAFE':
				if (!entered) safe = safeY(piece);
				return moveStep(() => ({ y: safe }), 'MOVE_OVER_SOCKET');
			case 'MOVE_OVER_SOCKET':
				liveTargets(piece);
				return moveStep(() => ({ x: A.x, z: A.z, y: safe }), 'SETTLE_SOCKET', true);
			case 'SETTLE_SOCKET':
				return settle(dt, SETTLE_TOL, SETTLE_TIMEOUT, 'LOWER_TO_APPROACH');
			case 'LOWER_TO_APPROACH':
				liveTargets(piece);
				return moveStep(() => ({ x: A.x, z: A.z, y: A.y }), 'INSERT', true);
			case 'INSERT':
				liveTargets(piece);
				return moveStep(() => ({ x: G.x, z: G.z, y: G.y }), 'SETTLE_INSERT', true);
			case 'SETTLE_INSERT':
				return settle(dt, INSERT_SETTLE_TOL, INSERT_SETTLE_TIMEOUT, 'RELEASE');
			case 'RELEASE':
				if (!entered) {
					loadout.mountPiece(piece);
					carried = false;
					api.setMagnet(false);
					entered = true;
				}
				return dwell(dt, RELEASE_DWELL, 'RETRACT');
			case 'RETRACT':
				liveTargets(piece);
				return moveStep(() => ({ x: A.x, z: A.z, y: A.y }), 'RETRACT_UP', true);
			case 'RETRACT_UP':
				if (!entered) safe = safeY(null);
				return moveStep(() => ({ y: safe }), 'NEXT');
			case 'NEXT':
				return nextPiece();
			case 'PARK_RAISE':
				if (!entered) safe = safeY(null);
				return moveStep(() => ({ y: safe }), 'PARK_XZ');
			case 'PARK_XZ':
				return moveStep(() => ({ x: PARK_XZ.x, z: PARK_XZ.z, y: safe }), 'PARK_Y');
			case 'PARK_Y':
				return moveStep(() => ({ y: PARK_Y }), 'DONE');
			case 'DONE':
				phase = 'done';
				api.setAuto(false);
				onDone?.();
		}
	}

	const label = (piece) => `${piece.label} (${all.indexOf(piece) + 1}/${total})`;
	const STATUS = {
		RAISE: 'Raising',
		MOVE_OVER_PART: 'Moving over',
		SETTLE_PART: 'Steadying over',
		LOWER_TO_GRAB: 'Lowering to grab',
		GRAB: 'Grabbing',
		LIFT_SAFE: 'Lifting',
		MOVE_OVER_SOCKET: 'Carrying',
		SETTLE_SOCKET: 'Steadying',
		LOWER_TO_APPROACH: 'Lowering',
		INSERT: 'Inserting',
		SETTLE_INSERT: 'Inserting',
		RELEASE: 'Releasing',
		RETRACT: 'Retracting',
		RETRACT_UP: 'Retracting',
	};

	return {
		get phase() {
			return phase;
		},
		start(pieces) {
			all = [...pieces];
			queue = all.filter((piece) => !piece.mounted);
			total = all.length;
			current = null;
			carried = false;
			warned = false;
			api.setAuto(true);
			api.setMagnet(false);
			phase = 'running';
			go('RAISE');
			nextPiece();
			// First move: raise, then go over the first piece (RAISE hands over to MOVE_OVER_PART)
			if (current) go('RAISE');
			else go('PARK_RAISE');
		},
		update(dt) {
			if (phase === 'resetting') {
				if (api.arrived()) {
					api.setAuto(false);
					phase = 'idle';
				}
				return;
			}
			if (phase !== 'running') return;
			if (carried || step === 'RELEASE') shadows?.markDirty();
			tick(dt);
			if (carried) shadows?.markDirty();
		},
		complete() {
			if (phase !== 'running') return;
			for (const piece of all) if (!piece.mounted) loadout.mountPiece(piece);
			carried = false;
			queue = [];
			current = null;
			api.setMagnet(false);
			shadows?.markDirty();
			go('PARK_RAISE');
		},
		cancel() {
			if (phase !== 'running') return;
			if (carried && current) {
				layout.group.attach(current.part);
				carried = false;
			}
			current = null;
			queue = [];
			api.setMagnet(false);
			api.setPrecision(false);
			api.setSwingLock(false);
			api.moveTo({ y: PARK_Y });
			phase = 'resetting';
		},
		status() {
			if (phase === 'idle') return 'Idle';
			if (phase === 'done') return 'Done';
			if (phase === 'resetting') return 'Resetting';
			if (step.startsWith('PARK') || step === 'DONE') return 'Parking';
			if (!current) return 'Running';
			return `${STATUS[step] ?? 'Working'} · ${label(current)}`;
		},
	};
}
