import * as THREE from 'three';

import { setBoxProjectedUVs } from '../geometry/uv.js';

/**
 * Central assembly platform, centred at the hangar origin. `size` is the outer side of the square frame and
 * `height` the top of its rails, where the fuselage will rest.
 */
export const PLATFORM = {
	size: 10,
	height: 0.6,
	railWidth: 0.6,
};

const S = PLATFORM.size;
const HALF = S / 2;
const RAIL = PLATFORM.railWidth;
const RAIL_H = PLATFORM.height;

/**
 * Builds the platform: recessed deck, perimeter rails, corner clamp blocks, side lights, yellow floor outline and a
 * power console linked by cables. All lamps are emissive meshes (no real lights).
 *
 * The returned group exposes `userData.mountPoint`, an `Object3D` at the centre of the rail tops, to which the
 * fuselage will be attached.
 */
export function buildPlatform(materials) {
	const platform = new THREE.Group();
	platform.name = 'platform';

	const ctx = { materials, tile: materials.tileSizes.metal };

	platform.add(buildDeck(ctx));
	platform.add(buildRails(ctx));
	platform.add(buildCornerClamps(ctx));
	platform.add(buildFloorOutline(ctx));
	platform.add(buildConsole(ctx));

	const mountPoint = new THREE.Object3D();
	mountPoint.name = 'mount-point';
	mountPoint.position.set(0, RAIL_H, 0);
	platform.add(mountPoint);
	platform.userData.mountPoint = mountPoint;

	return platform;
}

function box(width, height, depth, material, tileSize) {
	const geometry = new THREE.BoxGeometry(width, height, depth);
	if (tileSize) setBoxProjectedUVs(geometry, tileSize);
	return new THREE.Mesh(geometry, material);
}

function place(mesh, x, y, z) {
	mesh.position.set(x, y, z);
	return mesh;
}

/**
 * Deck sunk below the rails, with a grid of raised ribs.
 */
function buildDeck({ materials, tile }) {
	const deck = new THREE.Group();
	deck.name = 'deck';

	const inner = S - 2 * RAIL;
	const deckTop = 0.3;
	deck.add(place(box(inner, deckTop, inner, materials.darkMetal, tile), 0, deckTop / 2, 0));

	const ribHeight = 0.06;
	const ribWidth = 0.12;
	for (const offset of [-inner / 4, 0, inner / 4]) {
		deck.add(place(box(inner, ribHeight, ribWidth, materials.wall, tile), 0, deckTop + ribHeight / 2, offset));
		deck.add(place(box(ribWidth, ribHeight, inner, materials.wall, tile), offset, deckTop + ribHeight / 2, 0));
	}

	return deck;
}

/**
 * Four perimeter rails, each with three small warm lights on its outer face.
 */
function buildRails({ materials, tile }) {
	const rails = new THREE.Group();
	rails.name = 'rails';

	const center = HALF - RAIL / 2;
	const lampOffsets = [-S / 4, 0, S / 4];

	for (const side of [1, -1]) {
		// Rails along x (front/back) span the full side; rails along z fit between them
		rails.add(place(box(S, RAIL_H, RAIL, materials.wall, tile), 0, RAIL_H / 2, side * center));
		rails.add(place(box(RAIL, RAIL_H, S - 2 * RAIL, materials.wall, tile), side * center, RAIL_H / 2, 0));

		// Darker top strip on each rail
		const capHeight = 0.04;
		rails.add(place(box(S, capHeight, RAIL * 0.5, materials.darkMetal, tile), 0, RAIL_H, side * center));
		rails.add(
			place(box(RAIL * 0.5, capHeight, S - 2 * RAIL, materials.darkMetal, tile), side * center, RAIL_H, 0)
		);

		for (const offset of lampOffsets) {
			const lampZ = box(0.45, 0.1, 0.04, materials.lampWarm);
			rails.add(place(lampZ, offset, RAIL_H * 0.5, side * (HALF + 0.02)));

			const lampX = box(0.04, 0.1, 0.45, materials.lampWarm);
			rails.add(place(lampX, side * (HALF + 0.02), RAIL_H * 0.5, offset));
		}
	}

	return rails;
}

/**
 * Raised clamp blocks on the four corners: a block, a horizontal hydraulic cylinder on top and marker lights.
 */
function buildCornerClamps({ materials, tile }) {
	const clamps = new THREE.Group();
	clamps.name = 'corner-clamps';

	const blockSize = 1.2;
	const blockHeight = 0.9;
	const center = HALF - blockSize / 2 + 0.1;
	const cylinderGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.9, 20);

	for (const sx of [1, -1]) {
		for (const sz of [1, -1]) {
			const clamp = new THREE.Group();
			clamp.position.set(sx * center, 0, sz * center);

			clamp.add(place(box(blockSize, blockHeight, blockSize, materials.darkMetal, tile), 0, blockHeight / 2, 0));

			// Cylinder aligned with the diagonal, pointing at the platform centre
			const cylinder = new THREE.Mesh(cylinderGeometry, materials.wall);
			cylinder.rotation.set(Math.PI / 2, 0, 0);
			const pivot = new THREE.Group();
			pivot.rotation.y = Math.atan2(sx, sz);
			pivot.position.y = blockHeight + 0.22;
			pivot.add(cylinder);
			clamp.add(pivot);

			// Marker lights on the two outer faces
			const faceOffset = blockSize / 2 + 0.02;
			clamp.add(place(box(0.3, 0.12, 0.04, materials.lampWarm), 0, blockHeight * 0.6, sz * faceOffset));
			clamp.add(place(box(0.04, 0.12, 0.3, materials.lampWarm), sx * faceOffset, blockHeight * 0.6, 0));

			clamps.add(clamp);
		}
	}

	return clamps;
}

/**
 * Yellow safety outline painted on the floor around the platform.
 */
function buildFloorOutline({ materials }) {
	const outline = new THREE.Group();
	outline.name = 'floor-outline';

	const margin = 0.9;
	const width = 0.22;
	const thickness = 0.01;
	const side = S + 2 * margin;
	const offset = side / 2 - width / 2;

	for (const sign of [1, -1]) {
		outline.add(place(box(side, thickness, width, materials.trim), 0, thickness / 2, sign * offset));
		outline.add(place(box(width, thickness, side - 2 * width, materials.trim), sign * offset, thickness / 2, 0));
	}

	return outline;
}

/**
 * Power console beside the platform, with a cyan screen facing the back of the hangar and two cables running
 * along the floor to the nearest rail. The cables are tubes swept along Catmull-Rom curves.
 */
function buildConsole({ materials, tile }) {
	const group = new THREE.Group();
	group.name = 'console';

	const consoleX = -(HALF + 2.2);
	const consoleZ = 2.5;
	const width = 0.9;
	const height = 1.6;
	const depth = 0.7;

	group.add(place(box(width, height, depth, materials.darkMetal, tile), consoleX, height / 2, consoleZ));
	group.add(place(box(width + 0.1, 0.1, depth + 0.1, materials.wall, tile), consoleX, height + 0.05, consoleZ));
	group.add(place(box(width + 0.1, 0.15, depth + 0.1, materials.wall, tile), consoleX, 0.075, consoleZ));

	// Screen and status light on the face looking towards the back wall (-z)
	const frontZ = consoleZ - depth / 2 - 0.01;
	group.add(place(box(0.5, 0.32, 0.02, materials.lampCool), consoleX, height * 0.68, frontZ));
	group.add(place(box(0.12, 0.05, 0.02, materials.lampWarm), consoleX, height * 0.45, frontZ));

	// Cables from the console's platform-facing side to the outer face of the rail
	const startX = consoleX + width / 2;
	const endX = -HALF;
	for (const dz of [-0.15, 0.15]) {
		const z = consoleZ + dz;
		const path = new THREE.CatmullRomCurve3(
			[
				new THREE.Vector3(startX, 0.35, z),
				new THREE.Vector3(startX + 0.25, 0.07, z - 0.3),
				new THREE.Vector3(startX + 0.9, 0.07, z - 0.9 + dz),
				new THREE.Vector3(endX - 0.35, 0.07, z - 1.4),
				new THREE.Vector3(endX, 0.3, z - 1.5),
			],
			false,
			'centripetal'
		);
		group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 48, 0.06, 10, false), materials.rubber));
	}

	return group;
}
