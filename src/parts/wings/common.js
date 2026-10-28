import * as THREE from 'three';

import { buildPadCover } from '../sockets.js';

/**
 * Dimensions and helpers shared by every wing variant. Wings are built for the left side (+x outwards, +z forward,
 * +y up), relative to the fuselage `socket_wing_*`.
 */
export const ROOT_CHORD = 2.0;
export const ROOT_CENTER_Z = -0.2; // chord centre at the root, relative to the fuselage socket
export const HARDPOINT_SPAN = 0.9; // distance from the root to the top hardpoint
const PAD_RADIUS = 0.15;

/**
 * Dark root fairing against the hull, `height` tall.
 */
export function buildFairing(materials, height) {
	const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.16, height, ROOT_CHORD * 0.85), materials.hullDark);
	fairing.name = 'root-fairing';
	fairing.position.set(0.06, 0, ROOT_CENTER_Z);
	return fairing;
}

/**
 * Top hardpoint on a panel: socket + round pad cover, both children of `parent` so mounted parts follow it. The wing
 * itself is already mirrored on the right, so the socket stays 'L' (no second mirror).
 */
export function addTopHardpoint(parent, position, materials) {
	const socket = new THREE.Object3D();
	socket.name = 'socket_wing_top';
	socket.position.copy(position);
	socket.userData = { side: 'L', outward: new THREE.Vector3(0, 1, 0) };
	socket.userData.cover = buildPadCover(materials, socket.position, PAD_RADIUS);
	parent.add(socket, socket.userData.cover);
	return socket;
}
