import * as THREE from 'three';

import { bezierChain2, roundedRectangle } from '../../geometry/curves.js';
import { buildRevolutionGeometry, buildVariableSweepGeometry } from '../../geometry/sweep.js';
import { addMuzzleFlash, box, buildPylon, place, supportDistance } from './common.js';

const defaults = { barrelCount: 6, barrelLength: 1.1 };

/**
 * Minigun: rotary cluster of 5–8 barrels held by clamp rings, a motor housing behind it, a boxy receiver and an ammo
 * feed chute that curves back into the hull. Only fits the wing and top (behind the cockpit) hardpoints.
 */
export const minigun = {
	label: 'Minigun',
	hardpoints: ['wing', 'top'],
	defaults,
	paramSchema: {
		barrelCount: { label: 'Barrels', min: 5, max: 8, step: 1 },
		barrelLength: { label: 'Barrel length', min: 0.9, max: 1.4, step: 0.05 },
	},
	build: buildMinigun,
};

// Receiver box, centred on the gun body origin
const RECEIVER = { width: 0.24, height: 0.22, back: -0.3, front: 0.08 };
const HOUSING_LENGTH = 0.2; // motor housing between the receiver and the rotor
const BARREL = { radius: 0.02, collar: 0.03, bore: 0.011 };
const BARREL_GAP = 0.008; // minimum gap between two neighbouring barrel collars
const CHUTE = { width: 0.11, height: 0.06, corner: 0.018 };
const DEFAULT_CLEARANCE = 0.12;
const STEP_DURATION = 0.12; // seconds to turn the cluster by one barrel

/**
 * Gun group (origin = attach point on the hull) → body (pushed out along `outward`) → receiver, motor housing, rotor.
 * The rotor holds the barrels, clamp rings and spindle and turns about the barrel axis (body z).
 *
 * `userData`:
 * - `barrelCount`, `stepAngle` (2π / barrelCount).
 * - `fire()`: shows a muzzle spark and queues one step, i.e. the cluster turns by exactly one barrel. Steps run one
 *   after the other.
 * - `update(dt)`: fades the spark and advances the queued steps; call it every frame.
 * - `muzzle`: `Object3D` at the muzzle of the firing (top) barrel. It is not in the rotor, and after every step a
 *   barrel is back in the top slot, so it is the spot for a muzzle flash.
 */
function buildMinigun(params, materials, { outward = new THREE.Vector3(1, 0, 0), clearance = DEFAULT_CLEARANCE } = {}) {
	const { barrelLength } = { ...defaults, ...params };
	const barrelCount = THREE.MathUtils.clamp(Math.round(params?.barrelCount ?? defaults.barrelCount), 5, 8);
	const normal = outward.clone().normalize();

	// Cluster radius: barrel axes on a circle wide enough that neighbouring collars never touch
	const clusterRadius = Math.max(0.06, (BARREL.collar + BARREL_GAP / 2) / Math.sin(Math.PI / barrelCount));
	const housingRadius = clusterRadius + BARREL.collar + 0.02;
	const rotorZ = RECEIVER.front + HOUSING_LENGTH;

	const gun = new THREE.Group();
	gun.name = 'minigun';

	// Push the body out along the normal until its nearest point is `clearance` away from the hull
	const bounds = new THREE.Box3(
		new THREE.Vector3(-housingRadius, -housingRadius, RECEIVER.back),
		new THREE.Vector3(housingRadius, Math.max(housingRadius, RECEIVER.height / 2 + 0.12), rotorZ) // top rail
	);
	const reach = supportDistance(bounds, normal.clone().negate()) + clearance;
	const body = new THREE.Group();
	body.name = 'gun-body';
	body.position.copy(normal).multiplyScalar(reach);
	gun.add(body);

	gun.add(buildPylon(normal, clearance, materials.hullDark));

	buildReceiver(body, materials);

	// Motor housing: revolved around its Y axis, then turned so Y points along +z
	const housing = new THREE.Mesh(
		buildRevolutionGeometry({ profile: housingProfile(housingRadius), segmentsPerCurve: 8, radialSegments: 32 }),
		materials.gunMetal
	);
	housing.name = 'motor-housing';
	housing.rotation.x = Math.PI / 2;
	body.add(place(housing, 0, 0, RECEIVER.front));

	const rotor = buildRotor(barrelCount, clusterRadius, barrelLength, materials);
	body.add(place(rotor, 0, 0, rotorZ));

	const chute = new THREE.Mesh(buildChuteGeometry(normal, reach), materials.hullDark);
	chute.name = 'feed-chute';
	// Tagged so the part viewer can show the technique on its own
	chute.userData.technique = 'curvedSweep';
	gun.add(chute);

	const muzzle = new THREE.Object3D();
	muzzle.name = 'muzzle';
	body.add(place(muzzle, 0, clusterRadius, rotorZ + barrelLength));

	const spin = spinner(rotor, barrelCount);
	const flash = addMuzzleFlash(muzzle);
	gun.userData = {
		barrelCount,
		muzzle,
		stepAngle: spin.stepAngle,
		fire() {
			flash.fire();
			spin.fire();
		},
		update(dt) {
			flash.update(dt);
			spin.update(dt);
		},
	};

	return gun;
}

/**
 * One-barrel steps of the rotor: `fire()` queues a step, `update(dt)` turns the rotor by 2π / barrelCount per step
 * with a smoothstep ease. The angle is rebuilt from an integer step count, so it never drifts.
 */
function spinner(rotor, barrelCount) {
	const stepAngle = (2 * Math.PI) / barrelCount;
	let index = 0; // steps completed (mod barrelCount)
	let pending = 0;
	let t = null; // progress of the running step, null when idle

	return {
		stepAngle,
		fire() {
			pending++;
		},
		update(dt) {
			if (t === null) {
				if (pending === 0) return;
				pending--;
				t = 0;
			}
			t = Math.min(1, t + dt / STEP_DURATION);
			rotor.rotation.z = (index + THREE.MathUtils.smoothstep(t, 0, 1)) * stepAngle;
			if (t === 1) {
				index = (index + 1) % barrelCount;
				rotor.rotation.z = index * stepAngle;
				t = null;
			}
		},
	};
}

/**
 * Receiver: main box, top frame with a carry rail and a rear sight, side plate with bolts, rear grip block.
 */
function buildReceiver(body, materials) {
	const { width, height, back, front } = RECEIVER;
	const length = front - back;
	const centerZ = (front + back) / 2;

	body.add(place(box(width, height, length, materials.gunMetal), 0, 0, centerZ));

	// Top frame: two posts and a rail, like the reference's carry frame
	const railY = height / 2 + 0.07;
	for (const z of [back + 0.06, front - 0.04]) {
		body.add(place(box(0.03, 0.07, 0.03, materials.hullDark), 0, height / 2 + 0.035, z));
	}
	body.add(place(box(0.04, 0.025, length - 0.04, materials.hullDark), 0, railY, centerZ));
	body.add(place(box(0.05, 0.04, 0.03, materials.hullDark), 0, railY + 0.03, back + 0.08));

	// Side plates with bolts on both sides
	for (const side of [-1, 1]) {
		const x = side * (width / 2 + 0.006);
		body.add(place(box(0.012, height * 0.7, length * 0.7, materials.hullDark), x, 0, centerZ));
		for (const z of [back + 0.08, centerZ, front - 0.08]) {
			const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10), materials.chrome);
			bolt.rotation.z = Math.PI / 2;
			body.add(place(bolt, x + side * 0.008, 0.05, z));
		}
	}

	// Rear block (motor drive / grip mount)
	body.add(place(box(width * 0.7, height * 0.8, 0.06, materials.hullDark), 0, 0, back - 0.03));
}

/**
 * Motor housing profile (x = radius, y = length along the barrels), Bézier chain: closed back face, rounded bell, a
 * waist, a front collar and the front face down to the spindle. Bell and waist joins are C1; face edges are knots.
 */
function housingProfile(R) {
	const L = HOUSING_LENGTH;
	const v = (x, y) => new THREE.Vector2(x, y);
	const line = (a, b) => [a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3), b];

	const back = v(0, 0);
	const bellStart = v(R * 0.75, 0);
	const bellEnd = v(R, L * 0.25);
	const waist = v(R * 0.9, L * 0.55);
	const collarStart = v(R, L * 0.75);
	const collarEnd = v(R + 0.01, L);
	const spindle = v(0.03, L);

	return bezierChain2([
		back,
		...line(back, bellStart),
		// Rounded bell: horizontal at the back face, vertical at the side
		v(R * 0.92, 0),
		v(R, L * 0.08),
		bellEnd,
		// Waist dipping in and back out (C1 with the bell)
		v(R, L * 0.38),
		v(R * 0.9, L * 0.42),
		waist,
		v(R * 0.9, L * 0.66),
		v(R, L * 0.68),
		collarStart,
		// Collar, slightly flared to the front
		...line(collarStart, collarEnd),
		// Front face, inwards to the spindle
		...line(collarEnd, spindle),
	]);
}

/**
 * Rotor (local z = barrel axis): `count` barrels on a circle of `radius`, the first one at the top (+y), plus a
 * spindle and three clamp rings with one hole per barrel.
 */
function buildRotor(count, radius, length, materials) {
	const rotor = new THREE.Group();
	rotor.name = 'rotor';

	// Every barrel shares one revolution geometry (revolved around Y, turned so Y points along +z)
	const barrelGeometry = buildRevolutionGeometry({
		profile: barrelProfile(length),
		segmentsPerCurve: 6,
		radialSegments: 16,
	});
	const slots = Array.from({ length: count }, (_, k) => {
		const angle = Math.PI / 2 + (k * 2 * Math.PI) / count;
		return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
	});
	for (const slot of slots) {
		const barrel = new THREE.Mesh(barrelGeometry, materials.gunMetal);
		barrel.name = 'barrel';
		barrel.rotation.x = Math.PI / 2;
		rotor.add(place(barrel, slot.x, slot.y, 0));
	}

	const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, length * 0.75, 16), materials.hullDark);
	spindle.rotation.x = Math.PI / 2;
	rotor.add(place(spindle, 0, 0, (length * 0.75) / 2));

	// Clamp rings: a disc with one hole per barrel, extruded along +z (flat detail, not a required technique)
	const ring = new THREE.Shape().absarc(0, 0, radius + BARREL.collar + 0.012, 0, 2 * Math.PI, false);
	for (const slot of slots) {
		ring.holes.push(new THREE.Path().absarc(slot.x, slot.y, BARREL.radius + 0.002, 0, 2 * Math.PI, true));
	}
	const ringGeometry = new THREE.ExtrudeGeometry(ring, { depth: 0.04, bevelEnabled: false, curveSegments: 24 });
	for (const z of [0.35 * length, 0.7 * length, length - 0.12]) {
		rotor.add(place(new THREE.Mesh(ringGeometry, materials.hullDark), 0, 0, z));
	}

	return rotor;
}

/**
 * Barrel profile (x = radius, y = distance from the rotor face), Bézier chain: breech collar → step down → tube →
 * muzzle lip → muzzle face → bore → bore bottom. All joins are sharp knots except along the straight runs.
 */
function barrelProfile(length) {
	const L = length;
	const { radius: r, collar, bore } = BARREL;
	const v = (x, y) => new THREE.Vector2(x, y);
	const line = (a, b) => [a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3), b];

	const points = [v(collar, 0)];
	const to = (x, y) => points.push(...line(points[points.length - 1], v(x, y)));
	to(collar, 0.06); // breech collar
	// Step down to the tube with a curved shoulder
	points.push(v(collar, 0.075), v(r, 0.07), v(r, 0.09));
	to(r, L - 0.07); // tube
	to(r + 0.006, L - 0.06); // muzzle lip
	to(r + 0.006, L);
	to(bore, L); // muzzle face, inwards
	to(bore, L - 0.12); // bore, back inside the barrel (faces the axis)
	to(0, L - 0.12); // bore bottom
	return bezierChain2(points);
}

/**
 * Ammo feed chute: a rounded-rectangle section swept along a curved path (sections oriented along it). It leaves the
 * back of the receiver going backwards, then bends towards the hull and enters it behind the pylon, so it works for
 * any hull `normal`. Both ends are buried (in the receiver and in the hull), so no caps.
 */
function buildChuteGeometry(normal, reach) {
	const back = new THREE.Vector3(0, 0, -1);
	const at = (out, z) => normal.clone().multiplyScalar(out).addScaledVector(back, -z);
	const path = new THREE.CubicBezierCurve3(
		at(reach, RECEIVER.back + 0.05),
		at(reach, RECEIVER.back - 0.3),
		at(reach * 0.35, RECEIVER.back - 0.45),
		at(-0.06, RECEIVER.back - 0.45)
	);
	const section = roundedRectangle(CHUTE.width / 2, CHUTE.height / 2, CHUTE.corner);

	return buildVariableSweepGeometry({
		shapeAt: () => section,
		path,
		segmentsPerCurve: 4,
		levels: 32,
		caps: { start: false, end: false },
		up: normal,
		frameMethod: 'parallel',
	});
}
