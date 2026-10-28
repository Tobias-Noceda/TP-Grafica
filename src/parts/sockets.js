import * as THREE from 'three';

/**
 * Shared socket helpers for every part that offers attach points (fuselage, wings).
 *
 * A socket is an `Object3D` whose `userData` may hold:
 * - `side`: 'L', 'R' or 'C' (centre). Parts are built for the left side; `mountPart` mirrors them on 'R' sockets
 *   (`scale.x = -1`). Sockets inside an already mirrored part (e.g. a right wing) stay 'L' so the part is not mirrored
 *   twice, and centre sockets hold symmetric parts that are never mirrored.
 * - `outward`: unit surface normal in the part's own (left-side) frame, telling a builder which way to grow.
 * - `clearance`: optional gap the mounted part should keep from the surface.
 * - `cover`: object shown while the socket is empty. Keep it a sibling of the socket so mounting never hides it.
 */
export function mountPart(socket, part) {
	if (socket.userData.side === 'R') part.scale.x = -1;
	socket.add(part);
	if (socket.userData.cover) socket.userData.cover.visible = false;
}

/**
 * Removes and returns every part mounted on the socket, showing its cover again.
 */
export function unmountPart(socket) {
	const parts = [...socket.children];
	if (parts.length) socket.remove(...parts);
	if (socket.userData.cover) socket.userData.cover.visible = true;
	return parts;
}

/**
 * Round mounting pad for an unused socket on an upper surface, so it reads differently from the side hatches: a white
 * disc with a red ring and a chrome hub. Built on local +y.
 */
export function buildPadCover(materials, position, radius) {
	const pad = new THREE.Group();
	pad.name = 'socket-pad';
	pad.position.copy(position);

	const height = 0.03;
	const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28), materials.hullPaint);
	disc.position.y = height / 2;
	pad.add(disc);

	const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.72, 0.012, 8, 28), materials.hullRed);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = height;
	pad.add(ring);

	const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), materials.chrome);
	hub.position.y = height + 0.01;
	pad.add(hub);

	return pad;
}
