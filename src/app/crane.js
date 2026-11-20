import * as THREE from 'three';

import { HANGAR } from '../hangar/hangar.js';

// Runway: the two longitudinal ceiling girders of the hangar (src/hangar/hangar.js) at x = ±craneRailX, bottom at H - 1.8
const RAIL_X = HANGAR.craneRailX;
const RAIL_BOTTOM = HANGAR.height - 1.8;
// Underhung crane: everything hangs below the girders (the ceiling beams leave no room above them)
const BRIDGE_Y = RAIL_BOTTOM - 0.6; // centre of the bridge girders
const TROLLEY_Y = BRIDGE_Y - 0.55; // centre of the trolley frame
const PIVOT_Y = TROLLEY_Y - 0.75; // bottom of the hoist drum, where the cable leaves it
const MAGNET_DROP = 1.2; // cable end → magnet face
const DRUM_RADIUS = 0.3;
const GRAVITY = 9.81;
const SWING_DAMPING = 2.2; // 1/s, close to critical: like an anti-sway hoist, the swing settles in about one period
const MAX_SUBSTEP = 1 / 120;

/** Hoist: cable length range (m) and speed. The magnet face can come down to 0.2 m above the floor. */
export const HOIST = {
	min: 1.5,
	max: PIVOT_Y - MAGNET_DROP - 0.2,
	initial: 5.2,
	maxSpeed: 1.2,
	accel: 1,
};
const faceYAt = (length) => PIVOT_Y - length - MAGNET_DROP;
const lengthForFaceY = (y) => PIVOT_Y - MAGNET_DROP - y;

/** Travel limits (world metres): trolley between the end trucks, bridge clear of the back wall and the front header. */
export const CRANE_LIMITS = {
	x: [-RAIL_X + 1.5, RAIL_X - 1.5],
	z: [-HANGAR.depth / 2 + 2.5, HANGAR.depth / 2 - 4],
	// Magnet-face world heights: [lowest, highest]
	y: [faceYAt(HOIST.max), faceYAt(HOIST.min)],
};

/**
 * Overhead (underhung) bridge crane, built from primitives. Hierarchy, each level carrying the next:
 *
 *   crane (fixed runway rails)
 *    └─ bridge   moves along z on the rails
 *        └─ trolley   moves along x on the bridge
 *            ├─ drum   hoist drum, rotates as the cable pays out (trolley.userData.drum)
 *            └─ swing   pivot at the hoist drum, rotates with the pendulum sway
 *                ├─ cable   unit-height cylinder scaled to the cable length
 *                └─ magnet   (at the cable end)
 *                    ├─ attachPoint (parts are `attach`ed here)
 *                    └─ cameraMount (crane camera)
 *
 * The tip is an electromagnet, so picking a part up is `attachPoint.attach(part)` and dropping it is
 * `socket.attach(part)`: no claw to animate.
 *
 * `userData` API:
 * - `bridge, trolley, swing, magnet, attachPoint, cameraMount, limits` (`limits.y` = magnet-face heights [low, high]).
 * - Manual: `setInput({ x, z })`, each -1, 0 or 1; horizontal only (the hoist is driven by `moveTo` alone). Ignored
 *   while auto is on.
 * - Automatic: `setAuto(on)` (clears inputs, raises anti-sway damping), `moveTo({ x, z, y })` (any subset; x/z are
 *   trolley/bridge world positions, y the magnet-FACE world height), `arrived()`, `settled(tolDeg)`.
 * - Queries: `faceWorldPosition(target)`, `cableLength()`, `speed()`, `maxSpeed`, `isMoving()`, `setMagnet(on)`.
 * - `update(dt)`: accelerates each carriage (x, z, hoist) towards its input or target, brakes before the end stops and
 *   swings the magnet from the carriages' acceleration.
 */
export function buildCrane(materials) {
	const crane = new THREE.Group();
	crane.name = 'crane';

	crane.add(buildRunway(materials));

	const bridge = buildBridge(materials);
	crane.add(bridge);

	const trolley = buildTrolley(materials);
	bridge.add(trolley);

	const swing = new THREE.Group();
	swing.name = 'crane-swing';
	swing.position.y = PIVOT_Y;
	trolley.add(swing);

	const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), materials.chrome);
	swing.add(cable);

	const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3b1c, emissiveIntensity: 0 });
	const magnet = buildMagnet(materials, ringMaterial);
	swing.add(magnet);

	// Parked over the back half of the hangar, clear of the ship
	bridge.position.z = -8;
	const drum = trolley.userData.drum;
	let cableLength = HOIST.initial;
	const applyCable = (length) => {
		drum.rotation.x += (length - cableLength) / DRUM_RADIUS;
		cableLength = length;
		cable.scale.y = length;
		cable.position.y = -length / 2;
		magnet.position.y = -length;
	};
	applyCable(HOIST.initial);
	const axes = {
		x: carriage(
			() => trolley.position.x,
			(v) => (trolley.position.x = v),
			CRANE_LIMITS.x,
			3.5,
			1.5
		),
		z: carriage(
			() => bridge.position.z,
			(v) => (bridge.position.z = v),
			CRANE_LIMITS.z,
			4,
			1.5
		),
		// Hoist state is the cable length, so +input (raise) means a negative length change (see `hoistInput`)
		y: carriage(() => cableLength, applyCable, [HOIST.min, HOIST.max], HOIST.maxSpeed, HOIST.accel),
	};
	// Pendulum angle per axis: positive means the magnet is displaced towards +x / +z
	const sway = { x: { angle: 0, rate: 0 }, z: { angle: 0, rate: 0 } };
	const input = { x: 0, z: 0, y: 0 };
	let auto = false;
	const clearTargets = () => {
		for (const key in axes) axes[key].target = null;
	};

	crane.userData = {
		bridge,
		trolley,
		swing,
		magnet,
		attachPoint: magnet.userData.attachPoint,
		cameraMount: magnet.userData.cameraMount,
		limits: CRANE_LIMITS,
		maxSpeed: Math.max(axes.x.maxSpeed, axes.z.maxSpeed),
		// Manual driving is horizontal only: the hoist moves only in the automatic assembly
		setInput({ x = 0, z = 0 } = {}) {
			if (auto) return;
			input.x = Math.sign(x);
			input.z = Math.sign(z);
			// Manual input takes over the axes it touches
			if (input.x) axes.x.target = null;
			if (input.z) axes.z.target = null;
		},
		setAuto(on) {
			auto = !!on;
			if (auto) {
				input.x = input.z = input.y = 0;
			} else {
				clearTargets();
			}
		},
		moveTo({ x, z, y } = {}) {
			if (x !== undefined) axes.x.setTarget(x);
			if (z !== undefined) axes.z.setTarget(z);
			if (y !== undefined) axes.y.setTarget(lengthForFaceY(y));
		},
		arrived: () => Object.values(axes).every((axis) => axis.target === null || axis.arrived),
		settled(tolDeg = 0.2) {
			const tol = THREE.MathUtils.degToRad(tolDeg);
			return [sway.x, sway.z].every((s) => Math.abs(s.angle) < tol && Math.abs(s.rate) < tol);
		},
		faceWorldPosition(target = new THREE.Vector3()) {
			crane.updateMatrixWorld(true);
			return magnet.userData.attachPoint.getWorldPosition(target);
		},
		cableLength: () => cableLength,
		update(dt) {
			// A long frame (tab in background) would blow the integration up
			dt = Math.min(dt, 0.1);
			if (dt <= 0) return;
			const steps = Math.ceil(dt / MAX_SUBSTEP);
			const h = dt / steps;
			for (let i = 0; i < steps; i++) {
				for (const key of ['x', 'z']) {
					const acceleration = axes[key].step(input[key], h);
					// Automatic drive: critical damping for the current cable length (anti-sway), the fastest
					// settle without swinging back. More damping would be overdamped and creep in slowly.
					const length = cableLength + 1;
					const damping = auto ? 2 * Math.sqrt(GRAVITY / length) : SWING_DAMPING;
					swingStep(sway[key], acceleration, length, damping, h);
				}
				axes.y.step(-input.y, h);
			}
			// Rotating about z by +a moves the hanging magnet towards +x; about x by -a moves it towards +z
			swing.rotation.set(-sway.z.angle, 0, sway.x.angle);
		},
		speed: () => Math.hypot(axes.x.velocity, axes.z.velocity),
		isMoving: () =>
			crane.userData.speed() > 1e-3 ||
			Math.abs(axes.y.velocity) > 1e-3 ||
			Math.abs(sway.x.rate) + Math.abs(sway.z.rate) > 1e-3,
		setMagnet(on) {
			ringMaterial.emissiveIntensity = on ? 4 : 0;
		},
	};
	return crane;
}

/**
 * One axis over a value reached through `get` / `set` (a carriage position or the cable length). Velocity eases
 * towards the desired one at a limited acceleration and is capped so the axis can always stop before the end of its
 * travel (v ≤ √(2·a·d)). Without a target the desired velocity is `input · maxSpeed`. With a target it is
 * sign(d)·min(maxSpeed, √(2·a_b·|d|)) using a reduced braking acceleration a_b = 0.45·a, and linear (v = k·d, matched
 * to the sqrt profile at |d| = ZONE) inside the last ZONE metres, so it glides in without overshoot or chatter; it
 * snaps to the target when |d| < 1 mm and |v| is small. `step` returns the acceleration it applied.
 */
const TARGET_ZONE = 0.05;
function carriage(get, set, [min, max], maxSpeed, accel) {
	const brake = 0.45 * accel;
	const gain = Math.sqrt((2 * brake) / TARGET_ZONE);
	const state = {
		position: get(),
		velocity: 0,
		maxSpeed,
		target: null,
		arrived: false,
		setTarget(value) {
			state.target = THREE.MathUtils.clamp(value, min, max);
			state.arrived = false;
		},
		step(input, dt) {
			const brakeUp = Math.sqrt(2 * accel * Math.max(max - state.position, 0));
			const brakeDown = -Math.sqrt(2 * accel * Math.max(state.position - min, 0));
			let wanted = input * maxSpeed;
			if (state.target !== null) {
				if (state.arrived) {
					wanted = 0;
				} else {
					const d = state.target - state.position;
					const mag = Math.abs(d);
					wanted =
						Math.sign(d) *
						(mag < TARGET_ZONE ? gain * mag : Math.min(maxSpeed, Math.sqrt(2 * brake * mag)));
				}
			}
			const desired = THREE.MathUtils.clamp(wanted, brakeDown, brakeUp);
			const before = state.velocity;
			const change = THREE.MathUtils.clamp(desired - before, -accel * dt, accel * dt);
			state.velocity += change;
			state.position += state.velocity * dt;
			if (state.position <= min || state.position >= max) {
				state.position = THREE.MathUtils.clamp(state.position, min, max);
				state.velocity = 0;
			}
			if (
				state.target !== null &&
				!state.arrived &&
				Math.abs(state.target - state.position) < 1e-3 &&
				Math.abs(state.velocity) < 0.02
			) {
				state.position = state.target;
				state.velocity = 0;
				state.arrived = true;
			}
			set(state.position);
			return (state.velocity - before) / dt;
		},
	};
	return state;
}

/**
 * Pendulum hanging from a carriage with acceleration `a`: θ'' = -(g/L)·sin θ - (a/L)·cos θ - c·θ'. Semi-implicit Euler.
 * Accelerating makes the magnet lag behind, stopping makes it swing past, and the swing then dies out slowly.
 */
function swingStep(state, acceleration, length, damping, dt) {
	const angular =
		-(GRAVITY / length) * Math.sin(state.angle) -
		(acceleration / length) * Math.cos(state.angle) -
		damping * state.rate;
	state.rate += angular * dt;
	state.angle += state.rate * dt;
}

function mesh(geometry, material, x = 0, y = 0, z = 0) {
	const m = new THREE.Mesh(geometry, material);
	m.position.set(x, y, z);
	return m;
}

/** Fixed level: a rail under each girder with end stops at both ends of the travel. */
function buildRunway(materials) {
	const runway = new THREE.Group();
	runway.name = 'crane-runway';
	const length = HANGAR.depth - 2;
	const railGeometry = new THREE.BoxGeometry(0.3, 0.12, length);
	const stopGeometry = new THREE.BoxGeometry(0.5, 0.4, 0.3);
	for (const side of [-1, 1]) {
		const x = side * RAIL_X;
		runway.add(mesh(railGeometry, materials.gunMetal, x, RAIL_BOTTOM - 0.06, 0));
		for (const z of CRANE_LIMITS.z) {
			const end = z + Math.sign(z) * 1.6;
			runway.add(mesh(stopGeometry, materials.trim, x, RAIL_BOTTOM - 0.25, end));
		}
	}
	return runway;
}

/** Bridge: two box girders across the hangar between end trucks that roll under the rails. */
function buildBridge(materials) {
	const bridge = new THREE.Group();
	bridge.name = 'crane-bridge';
	const span = 2 * RAIL_X;

	const girder = new THREE.BoxGeometry(span, 0.5, 0.35);
	const stripe = new THREE.BoxGeometry(span - 1.4, 0.12, 0.02);
	for (const side of [-1, 1]) {
		bridge.add(mesh(girder, materials.darkMetal, 0, BRIDGE_Y, side * 0.6));
		// Yellow capacity stripe on the outer faces
		bridge.add(mesh(stripe, materials.trim, 0, BRIDGE_Y, side * 0.785));
	}

	const truck = new THREE.BoxGeometry(0.7, 0.5, 2.6);
	const wheel = new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16).rotateZ(Math.PI / 2);
	const axle = new THREE.CylinderGeometry(0.05, 0.05, 1, 8).rotateZ(Math.PI / 2);
	for (const sideX of [-1, 1]) {
		const x = sideX * RAIL_X;
		bridge.add(mesh(truck, materials.trim, x, BRIDGE_Y + 0.05, 0));
		// Wheels on both sides of the rail flange, carried by the truck
		for (const z of [-0.9, 0.9]) {
			bridge.add(mesh(axle, materials.chrome, x, RAIL_BOTTOM - 0.2, z));
			for (const sideW of [-1, 1])
				bridge.add(mesh(wheel, materials.rubber, x + sideW * 0.32, RAIL_BOTTOM - 0.2, z));
		}
	}
	return bridge;
}

/** Trolley: frame rolling under the bridge girders, hoist drum and motor. */
function buildTrolley(materials) {
	const trolley = new THREE.Group();
	trolley.name = 'crane-trolley';

	trolley.add(mesh(new THREE.BoxGeometry(1.6, 0.3, 1.7), materials.trim, 0, TROLLEY_Y, 0));
	const wheel = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12);
	for (const x of [-0.6, 0.6]) {
		for (const z of [-0.6, 0.6]) {
			trolley.add(mesh(wheel, materials.rubber, x, BRIDGE_Y - 0.3, z).rotateX(Math.PI / 2));
		}
	}

	// Hoist: drum (axis x) between two side plates, motor and gearbox beside it
	const drumY = TROLLEY_Y - 0.45;
	const drum = mesh(
		new THREE.CylinderGeometry(DRUM_RADIUS, DRUM_RADIUS, 0.9, 20).rotateZ(Math.PI / 2),
		materials.gunMetal,
		0,
		drumY,
		0
	);
	// Marker stripe so the rotation is visible
	drum.add(mesh(new THREE.BoxGeometry(0.92, 0.03, 0.1), materials.trim, 0, DRUM_RADIUS, 0));
	trolley.add(drum);
	trolley.userData.drum = drum;
	const plate = new THREE.BoxGeometry(0.06, 0.8, 0.8);
	for (const x of [-0.5, 0.5]) trolley.add(mesh(plate, materials.darkMetal, x, drumY + 0.05, 0));
	trolley.add(mesh(new THREE.BoxGeometry(0.4, 0.4, 0.5), materials.darkMetal, 0.75, drumY + 0.05, 0));
	trolley.add(
		mesh(
			new THREE.CylinderGeometry(0.16, 0.16, 0.35, 16).rotateZ(Math.PI / 2),
			materials.hullDark,
			0.75,
			drumY + 0.05,
			0.4
		)
	);
	return trolley;
}

/** Electromagnet tip: hook block, spreader with two rods, magnet disc with a warning ring and an under-face camera. */
function buildMagnet(materials, ringMaterial) {
	const magnet = new THREE.Group();
	magnet.name = 'crane-magnet';

	magnet.add(mesh(new THREE.BoxGeometry(0.3, 0.35, 0.22), materials.trim, 0, -0.18, 0));
	magnet.add(mesh(new THREE.BoxGeometry(1, 0.08, 0.1), materials.gunMetal, 0, -0.4, 0));
	const rod = new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8);
	for (const x of [-0.42, 0.42]) magnet.add(mesh(rod, materials.chrome, x, -0.62, 0));

	const discY = -MAGNET_DROP + 0.2;
	magnet.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.32, 32), materials.hullDark, 0, discY, 0));
	magnet.add(mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.06, 32), materials.trim, 0, discY + 0.17, 0));
	magnet.add(mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.04, 32), materials.gunMetal, 0, discY - 0.18, 0));
	// Ring on the face: lights up while the magnet holds a part
	const ring = mesh(new THREE.RingGeometry(0.4, 0.5, 32), ringMaterial, 0, -MAGNET_DROP - 0.005, 0);
	ring.rotation.x = Math.PI / 2;
	magnet.add(ring);

	// Camera lens in the centre of the magnet face, inside the warning ring
	const faceY = -MAGNET_DROP;
	magnet.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16), materials.gunMetal, 0, faceY - 0.015, 0));
	magnet.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), materials.glass, 0, faceY - 0.04, 0));

	const attachPoint = new THREE.Object3D();
	attachPoint.name = 'crane-attach-point';
	attachPoint.position.y = -MAGNET_DROP;
	magnet.add(attachPoint);

	const cameraMount = new THREE.Object3D();
	cameraMount.name = 'crane-camera-mount';
	cameraMount.position.set(0, -MAGNET_DROP - 0.06, 0);
	magnet.add(cameraMount);

	magnet.userData = { attachPoint, cameraMount };
	return magnet;
}
