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

const FLASH_DURATION = 0.1; // s the spark stays visible after a shot
let flashMaterial = null;

/**
 * Muzzle spark at the origin of `muzzle`, firing along +z: a bright core and three crossed spikes (primitives, a
 * detail of the gun, not a main part). The material is additive and over-bright (HDR colour), so the bloom pass makes
 * it glow; it is shared by every gun. Returns `{ fire(), update(dt) }`: `fire()` shows a fresh spark with a random
 * roll, `update(dt)` shrinks it to nothing in `FLASH_DURATION` seconds and hides it.
 */
export function addMuzzleFlash(muzzle) {
	flashMaterial ??= new THREE.MeshBasicMaterial({
		color: new THREE.Color(9, 4.5, 1.6),
		blending: THREE.AdditiveBlending,
		transparent: true,
		depthWrite: false,
	});
	const flash = new THREE.Group();
	flash.name = 'muzzle-flash';
	flash.visible = false;
	const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), flashMaterial);
	core.scale.z = 1.6;
	flash.add(place(core, 0, 0, 0.04));
	const spike = new THREE.ConeGeometry(0.035, 0.3, 4, 1, true);
	spike.rotateX(Math.PI / 2).translate(0, 0, 0.15);
	for (let i = 0; i < 3; i++) {
		const mesh = new THREE.Mesh(spike.clone(), flashMaterial);
		mesh.rotation.z = (i * Math.PI) / 3;
		flash.add(mesh);
	}
	spike.dispose();
	muzzle.add(flash);

	let t = 1;
	return {
		fire() {
			t = 0;
			flash.visible = true;
			flash.rotation.z = Math.random() * Math.PI;
			flash.scale.setScalar(1);
		},
		update(dt) {
			if (!flash.visible) return;
			t = Math.min(1, t + dt / FLASH_DURATION);
			const s = 1 - t;
			flash.scale.set(0.6 + 0.4 * s, 0.6 + 0.4 * s, s);
			if (t === 1) flash.visible = false;
		},
	};
}
