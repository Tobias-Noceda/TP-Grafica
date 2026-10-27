import * as THREE from 'three';

/**
 * Shared landing gear dimensions, in metres.
 */
export const GEAR = {
	wheelRadius: 0.2,
	wheelWidth: 0.11,
	wheelOffset: 0.22, // x of each twin wheel from the leg axis
	strutFold: Math.PI / 2, // strut swings up to horizontal
	kneeFold: Math.PI * 0.9, // lower leg folds back under the strut
};

/**
 * Hierarchical landing gear: root (socket) → strut → knee → lowerLeg → wheel. Every rotating node sits on its joint, so
 * folding the strut carries the knee, leg and wheels with it.
 *
 * The root sits on the hinge; fully deployed, the wheels touch y = -height. `foldDirection` (±1) picks whether the gear
 * swings backwards (+1, towards -z) or forwards (-1) when retracting.
 *
 * Returns the root group with `userData.setDeploy(t)`, t ∈ [0, 1] (0 = retracted, 1 = deployed).
 */
export function buildLandingGear(materials, { height, foldDirection = 1 }) {
	const root = new THREE.Group();
	root.name = 'landing-gear';

	const legLength = height - GEAR.wheelRadius;
	const upperLength = legLength * 0.45;
	const lowerLength = legLength - upperLength;

	// Mount block on the belly
	root.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), materials.hullDark), 0, 0.02, 0));

	const strut = new THREE.Group();
	strut.name = 'strut';
	root.add(strut);
	strut.add(joint(0.08, 0.26, materials.chrome));
	strut.add(
		place(
			new THREE.Mesh(new THREE.BoxGeometry(0.12, upperLength, 0.14), materials.hullDark),
			0,
			-upperLength / 2,
			0
		)
	);

	const knee = new THREE.Group();
	knee.name = 'knee';
	knee.position.y = -upperLength;
	strut.add(knee);
	knee.add(joint(0.07, 0.2, materials.chrome));

	const lowerLeg = new THREE.Group();
	lowerLeg.name = 'lower-leg';
	knee.add(lowerLeg);

	// Shock absorber: outer sleeve on top, chrome piston below
	const sleeveLength = lowerLength * 0.5;
	lowerLeg.add(place(cylinder(0.065, sleeveLength, materials.hullDark), 0, -sleeveLength / 2, 0));
	lowerLeg.add(place(cylinder(0.04, lowerLength, materials.chrome), 0, -lowerLength / 2, 0));
	lowerLeg.add(
		place(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.1), materials.hullDark), 0, -lowerLength + 0.04, 0)
	);

	const wheel = new THREE.Group();
	wheel.name = 'wheel';
	wheel.position.y = -lowerLength;
	lowerLeg.add(wheel);
	wheel.add(joint(0.03, 2 * GEAR.wheelOffset + GEAR.wheelWidth, materials.chrome));

	for (const side of [1, -1]) {
		const tire = joint(GEAR.wheelRadius, GEAR.wheelWidth, materials.rubber, 28);
		tire.position.x = side * GEAR.wheelOffset;
		wheel.add(tire);

		const hub = joint(GEAR.wheelRadius * 0.55, GEAR.wheelWidth + 0.01, materials.hullDark, 20);
		hub.position.x = side * GEAR.wheelOffset;
		wheel.add(hub);
	}

	root.userData.setDeploy = (t) => {
		const fold = 1 - t;
		strut.rotation.x = foldDirection * fold * GEAR.strutFold;
		knee.rotation.x = -foldDirection * fold * GEAR.kneeFold;
	};
	root.userData.setDeploy(1);

	return root;
}

function place(mesh, x, y, z) {
	mesh.position.set(x, y, z);
	return mesh;
}

function cylinder(radius, length, material, segments = 16) {
	return new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
}

/**
 * Cylinder lying along x: hinge pins, axles and wheels.
 */
function joint(radius, length, material, segments = 16) {
	const mesh = cylinder(radius, length, material, segments);
	mesh.rotation.z = Math.PI / 2;
	return mesh;
}
