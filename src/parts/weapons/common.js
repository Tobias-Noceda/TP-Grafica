import * as THREE from 'three';

/**
 * Largest projection of the box onto `direction`: how far the box reaches from its origin that way.
 */
export function supportDistance(bounds, direction) {
	return ['x', 'y', 'z'].reduce(
		(sum, axis) => sum + Math.max(direction[axis] * bounds.min[axis], direction[axis] * bounds.max[axis]),
		0
	);
}

/**
 * Pylon from inside the hull to the gun body, along the socket's hull `normal`, `clearance` long (plus a bit buried).
 */
export function buildPylon(normal, clearance, material, { width = 0.12, depth = 0.4 } = {}) {
	const pylon = box(width, clearance + 0.04, depth, material);
	pylon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
	pylon.position.copy(normal).multiplyScalar(clearance / 2);
	return pylon;
}

/** Box mesh with its own geometry. */
export function box(width, height, depth, material) {
	return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

/** Sets the mesh position and returns it. */
export function place(mesh, x, y, z) {
	mesh.position.set(x, y, z);
	return mesh;
}
