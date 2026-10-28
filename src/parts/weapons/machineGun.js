import * as THREE from 'three';

import { bezierChain2 } from '../../geometry/curves.js';
import { buildRevolutionGeometry } from '../../geometry/sweep.js';

const defaults = { barrelLength: 1.1, muzzleFlare: 1 };

/**
 * Machine gun: boxy receiver on a pylon, with a Bézier-profile revolution barrel.
 */
export const machineGun = {
	label: 'Machine gun',
	defaults,
	paramSchema: {
		barrelLength: { label: 'Barrel length', min: 0.85, max: 1.5, step: 0.05 },
		muzzleFlare: { label: 'Muzzle flare', min: 0.6, max: 1.6, step: 0.05 },
	},
	build: buildMachineGun,
};

// Receiver box, centred on the gun body origin
const RECEIVER = { width: 0.2, height: 0.22, back: -0.25, front: 0.35 };

// Gun body bounds around its origin (barrel excluded), used to keep the body clear of the hull
const GUN_BOUNDS = new THREE.Box3(new THREE.Vector3(-0.1, -0.33, -0.25), new THREE.Vector3(0.21, 0.2, 0.4));
// Default gap between the hull and the gun body; a socket can ask for more with `clearance`
const DEFAULT_CLEARANCE = 0.12;

/**
 * Machine gun: pylon to the hull, boxy receiver with top rail, sights, cooling fins, cocking handle (outer side) and a
 * box magazine underneath. The barrel is a surface of revolution (see `barrelProfile`).
 */
function buildMachineGun(
	params,
	materials,
	{ outward = new THREE.Vector3(1, 0, 0), clearance = DEFAULT_CLEARANCE } = {}
) {
	const { barrelLength, muzzleFlare } = { ...defaults, ...params };
	const normal = outward.clone().normalize();

	const gun = new THREE.Group();
	gun.name = 'machine-gun';

	// Push the body out along the normal until its nearest point is `clearance` away from the hull
	const reach = supportDistance(GUN_BOUNDS, normal.clone().negate()) + clearance;
	const body = new THREE.Group();
	body.name = 'gun-body';
	body.position.copy(normal).multiplyScalar(reach);
	gun.add(body);

	// Pylon along the normal, from inside the hull to the body
	const pylon = box(0.12, clearance + 0.04, 0.4, materials.hullDark);
	pylon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
	pylon.position.copy(normal).multiplyScalar(clearance / 2);
	gun.add(pylon);

	const length = RECEIVER.front - RECEIVER.back;
	const centerZ = (RECEIVER.front + RECEIVER.back) / 2;
	const { width, height } = RECEIVER;
	const outerX = width / 2;

	body.add(place(box(width, height, length, materials.gunMetal), 0, 0, centerZ));

	// Top rail with notches, rear and front sights
	const railY = height / 2 + 0.015;
	body.add(place(box(0.06, 0.03, length - 0.1, materials.hullDark), 0, railY, centerZ));
	for (let i = 0; i < 7; i++) {
		const z = RECEIVER.back + 0.1 + i * 0.065;
		body.add(place(box(0.07, 0.012, 0.02, materials.chrome), 0, railY + 0.02, z));
	}
	body.add(place(box(0.05, 0.05, 0.03, materials.hullDark), 0, railY + 0.04, RECEIVER.back + 0.06));
	body.add(place(box(0.012, 0.06, 0.012, materials.chrome), 0, railY + 0.045, RECEIVER.front - 0.03));

	// Cooling fins and ejection port on the outer side
	for (let i = 0; i < 4; i++) {
		const z = RECEIVER.back + 0.08 + i * 0.06;
		body.add(place(box(0.03, height * 0.7, 0.02, materials.hullDark), outerX + 0.015, 0, z));
	}
	body.add(place(box(0.01, 0.06, 0.12, materials.hullDark), outerX + 0.005, 0.04, 0.18));

	// Cocking handle: rod out of the outer side with a knob
	const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 10), materials.chrome);
	rod.rotation.z = Math.PI / 2;
	body.add(place(rod, outerX + 0.05, -0.05, 0.05));
	body.add(
		place(new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), materials.hullDark), outerX + 0.1, -0.05, 0.05)
	);

	// Box magazine under the receiver
	body.add(place(box(0.16, 0.22, 0.26, materials.hullDark), 0, -height / 2 - 0.11, 0));
	body.add(place(box(0.17, 0.03, 0.27, materials.gunMetal), 0, -height / 2 - 0.2, 0));

	// Front plate holding the barrel
	body.add(place(box(0.16, 0.16, 0.04, materials.hullDark), 0, 0.02, RECEIVER.front + 0.02));

	// Barrel: revolved around its Y axis, then turned so Y points along +z
	const barrel = new THREE.Mesh(
		buildRevolutionGeometry({
			profile: barrelProfile(barrelLength, muzzleFlare),
			segmentsPerCurve: 10,
			radialSegments: 28,
		}),
		materials.gunMetal
	);
	barrel.name = 'barrel';
	barrel.rotation.x = Math.PI / 2;
	body.add(place(barrel, 0, 0.02, RECEIVER.front));

	return gun;
}

/**
 * Barrel profile (x = radius, y = distance from the receiver), a chain of cubic Béziers:
 * cooling jacket → S-shaped shoulder → long barrel → muzzle brake bulb → flared crown → muzzle face → bore → bore
 * bottom. Smooth joins are C1 (aligned control points); the collar, crown, face and bore edges are sharp knots.
 * `muzzleFlare` scales the bulb and crown radii.
 */
function barrelProfile(length, flare) {
	const L = length;
	const bulb = 0.065 * flare;
	const crown = 0.06 * flare;
	const bore = 0.018;
	const v = (x, y) => new THREE.Vector2(x, y);

	return bezierChain2([
		// Cooling jacket
		v(0.085, 0),
		v(0.085, 0.12),
		v(0.085, 0.26),
		v(0.085, 0.36),
		// Shoulder down to the barrel (C1 with the jacket and the barrel)
		v(0.085, 0.44),
		v(0.035, 0.42),
		v(0.035, 0.5),
		// Barrel, slightly tapering
		v(0.035, 0.5 + (L - 0.72) / 3),
		v(0.031, 0.5 + (2 * (L - 0.72)) / 3),
		v(0.03, L - 0.22),
		// Muzzle brake bulb (sharp collar at its start)
		v(bulb, L - 0.21),
		v(bulb, L - 0.11),
		v(0.042, L - 0.09),
		// Flared crown
		v(0.042, L - 0.05),
		v(crown * 0.8, L - 0.02),
		v(crown, L),
		// Muzzle face, inwards
		v(crown * 0.6, L),
		v(bore * 1.4, L),
		v(bore, L),
		// Bore, going back inside the barrel (faces the axis)
		v(bore, L - 0.1),
		v(bore, L - 0.2),
		v(bore, L - 0.3),
		// Bore bottom, closing the hole
		v(bore * 0.6, L - 0.3),
		v(bore * 0.3, L - 0.3),
		v(0, L - 0.3),
	]);
}

/**
 * Largest projection of the box onto `direction`: how far the box reaches from its origin that way.
 */
function supportDistance(bounds, direction) {
	return ['x', 'y', 'z'].reduce(
		(sum, axis) => sum + Math.max(direction[axis] * bounds.min[axis], direction[axis] * bounds.max[axis]),
		0
	);
}

function box(width, height, depth, material) {
	return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function place(mesh, x, y, z) {
	mesh.position.set(x, y, z);
	return mesh;
}
