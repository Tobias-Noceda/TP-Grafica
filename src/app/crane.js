import * as THREE from 'three';

import { HANGAR } from '../hangar/hangar.js';

// Runway: the two longitudinal ceiling girders of the hangar (src/hangar/hangar.js) at x = ±craneRailX, bottom at H - 1.8
const RAIL_X = HANGAR.craneRailX;
const RAIL_BOTTOM = HANGAR.height - 1.8;
// Underhung crane: everything hangs below the girders (the ceiling beams leave no room above them)
const BRIDGE_Y = RAIL_BOTTOM - 0.6; // centre of the bridge girders
const TROLLEY_Y = BRIDGE_Y - 0.55; // centre of the trolley frame
const PIVOT_Y = TROLLEY_Y - 0.75; // bottom of the hoist drum, where the cable leaves it
// Fixed cable length (no hoisting yet). The magnet face ends ~6 m above the floor, clear of the ship.
const CABLE = 5.2;
const MAGNET_DROP = 1.2; // cable end → magnet face
const SWING_LENGTH = CABLE + 1; // pendulum length, cable end to the magnet's centre of mass
const GRAVITY = 9.81;
const SWING_DAMPING = 2.2; // 1/s, close to critical: like an anti-sway hoist, the swing settles in about one period
const MAX_SUBSTEP = 1 / 120;

/** Travel limits (world metres): trolley between the end trucks, bridge clear of the back wall and the front header. */
export const CRANE_LIMITS = {
	x: [-RAIL_X + 1.5, RAIL_X - 1.5],
	z: [-HANGAR.depth / 2 + 2.5, HANGAR.depth / 2 - 4],
};

/**
 * Overhead (underhung) bridge crane, built from primitives. Hierarchy, each level carrying the next:
 *
 *   crane (fixed runway rails)
 *    └─ bridge   moves along z on the rails
 *        └─ trolley   moves along x on the bridge
 *            └─ swing   pivot at the hoist drum, rotates with the pendulum sway
 *                ├─ cable   fixed length
 *                └─ magnet   ├─ attachPoint (parts are `attach`ed here)
 *                            └─ cameraMount (crane camera)
 *
 * The tip is an electromagnet, so picking a part up is `attachPoint.attach(part)` and dropping it is
 * `socket.attach(part)`: no claw to animate.
 *
 * `userData`: `{ bridge, trolley, swing, magnet, attachPoint, cameraMount, limits, setInput({ x, z }), update(dt),
 * speed(), maxSpeed, isMoving(), setMagnet(on) }`. Inputs are -1, 0 or 1 per axis; `update` accelerates the carriages
 * towards them, brakes before the end stops and swings the magnet from the carriages' acceleration.
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

	const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, CABLE, 8), materials.chrome);
	cable.position.y = -CABLE / 2;
	swing.add(cable);

	const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3b1c, emissiveIntensity: 0 });
	const magnet = buildMagnet(materials, ringMaterial);
	magnet.position.y = -CABLE;
	swing.add(magnet);

	// Parked over the back half of the hangar, clear of the ship
	bridge.position.z = -8;
	const axes = {
		x: carriage(trolley, 'x', CRANE_LIMITS.x, 3.5, 1.5),
		z: carriage(bridge, 'z', CRANE_LIMITS.z, 4, 1.5),
	};
	// Pendulum angle per axis: positive means the magnet is displaced towards +x / +z
	const sway = { x: { angle: 0, rate: 0 }, z: { angle: 0, rate: 0 } };
	const input = { x: 0, z: 0 };

	crane.userData = {
		bridge,
		trolley,
		swing,
		magnet,
		attachPoint: magnet.userData.attachPoint,
		cameraMount: magnet.userData.cameraMount,
		limits: CRANE_LIMITS,
		maxSpeed: Math.max(axes.x.maxSpeed, axes.z.maxSpeed),
		setInput({ x = 0, z = 0 }) {
			input.x = Math.sign(x);
			input.z = Math.sign(z);
		},
		update(dt) {
			// A long frame (tab in background) would blow the integration up
			dt = Math.min(dt, 0.1);
			if (dt <= 0) return;
			const steps = Math.ceil(dt / MAX_SUBSTEP);
			const h = dt / steps;
			for (let i = 0; i < steps; i++) {
				for (const key of ['x', 'z']) {
					const acceleration = axes[key].step(input[key], h);
					swingStep(sway[key], acceleration, h);
				}
			}
			// Rotating about z by +a moves the hanging magnet towards +x; about x by -a moves it towards +z
			swing.rotation.set(-sway.z.angle, 0, sway.x.angle);
		},
		speed: () => Math.hypot(axes.x.velocity, axes.z.velocity),
		isMoving: () => crane.userData.speed() > 1e-3 || Math.abs(sway.x.rate) + Math.abs(sway.z.rate) > 1e-3,
		setMagnet(on) {
			ringMaterial.emissiveIntensity = on ? 4 : 0;
		},
	};
	return crane;
}

/**
 * One crane axis: velocity eases towards `input · maxSpeed` at a limited acceleration, and is capped so the carriage
 * can always stop before the end of its travel (v ≤ √(2·a·d)). `step` returns the acceleration it applied.
 */
function carriage(object, axis, [min, max], maxSpeed, accel) {
	const state = {
		position: object.position[axis],
		velocity: 0,
		maxSpeed,
		step(input, dt) {
			const brakeUp = Math.sqrt(2 * accel * Math.max(max - state.position, 0));
			const brakeDown = -Math.sqrt(2 * accel * Math.max(state.position - min, 0));
			const desired = THREE.MathUtils.clamp(input * maxSpeed, brakeDown, brakeUp);
			const before = state.velocity;
			const change = THREE.MathUtils.clamp(desired - before, -accel * dt, accel * dt);
			state.velocity += change;
			state.position += state.velocity * dt;
			if (state.position <= min || state.position >= max) {
				state.position = THREE.MathUtils.clamp(state.position, min, max);
				state.velocity = 0;
			}
			object.position[axis] = state.position;
			return (state.velocity - before) / dt;
		},
	};
	return state;
}

/**
 * Pendulum hanging from a carriage with acceleration `a`: θ'' = -(g/L)·sin θ - (a/L)·cos θ - c·θ'. Semi-implicit Euler.
 * Accelerating makes the magnet lag behind, stopping makes it swing past, and the swing then dies out slowly.
 */
function swingStep(state, acceleration, dt) {
	const angular =
		-(GRAVITY / SWING_LENGTH) * Math.sin(state.angle) -
		(acceleration / SWING_LENGTH) * Math.cos(state.angle) -
		SWING_DAMPING * state.rate;
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
	trolley.add(
		mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20).rotateZ(Math.PI / 2), materials.gunMetal, 0, drumY, 0)
	);
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
