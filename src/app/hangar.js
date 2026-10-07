import * as THREE from 'three';

import { setBoxProjectedUVs } from '../geometry/uv.js';

/**
 * Interior dimensions in metres. Floor at y = 0, back wall at z = -depth/2, open front at z = +depth/2.
 */
export const HANGAR = {
	width: 40,
	depth: 48,
	height: 16,
	baySpacing: 6,
};

const W = HANGAR.width;
const D = HANGAR.depth;
const H = HANGAR.height;
const HALF_W = W / 2;
const HALF_D = D / 2;

/**
 * Builds the hangar shell: floor, walls, ceiling structure, front frame, decorative props and interior lights.
 * Everything is placed in hangar space (the returned group sits at the world origin).
 */
export function buildHangar(materials) {
	const hangar = new THREE.Group();
	hangar.name = 'hangar';

	const ctx = { materials, tiles: materials.tileSizes };

	hangar.add(buildShell(ctx));
	hangar.add(buildSideWall(ctx, 1));
	hangar.add(buildSideWall(ctx, -1));
	hangar.add(buildBackWall(ctx));
	hangar.add(buildCeiling(ctx));
	hangar.add(buildFrontFrame(ctx));
	hangar.add(buildFloorMarkings(ctx));
	hangar.add(buildLights());

	return hangar;
}

/**
 * Axis-aligned box mesh. Textured materials get world-scale UVs so panels keep the same size on every face.
 */
function box(width, height, depth, material, tileSize) {
	const geometry = new THREE.BoxGeometry(width, height, depth);
	if (tileSize) setBoxProjectedUVs(geometry, tileSize);
	return new THREE.Mesh(geometry, material);
}

function place(mesh, x, y, z) {
	mesh.position.set(x, y, z);
	return mesh;
}

function buildShell({ materials, tiles }) {
	const shell = new THREE.Group();
	shell.name = 'shell';

	// The floor slab sticks out 2 m past the opening so its edge is visible against space
	const floor = box(W + 2, 0.6, D + 2, materials.floor, tiles.floor);
	shell.add(place(floor, 0, -0.3, 1));

	const ceiling = box(W + 2, 0.6, D, materials.wall, tiles.metal);
	shell.add(place(ceiling, 0, H + 0.3, 0));

	const back = box(W + 2, H, 0.6, materials.wall, tiles.metal);
	shell.add(place(back, 0, H / 2, -HALF_D - 0.3));

	for (const side of [1, -1]) {
		const wall = box(0.6, H, D, materials.wall, tiles.metal);
		shell.add(place(wall, side * (HALF_W + 0.3), H / 2, 0));
	}

	return shell;
}

/**
 * One side wall (side = +1 for +x, -1 for -x): structural columns with lamp strips, recessed panels,
 * catwalk balconies with railings and cargo crates on the floor.
 */
function buildSideWall({ materials, tiles }, side) {
	const wall = new THREE.Group();
	wall.name = side > 0 ? 'wall-right' : 'wall-left';

	const bays = D / HANGAR.baySpacing;
	const inward = -side; // direction towards the hangar centre along x
	const wallX = side * HALF_W;

	// Columns at every bay boundary except the front one, which belongs to the front frame
	for (let i = 0; i < bays; i++) {
		const z = -HALF_D + i * HANGAR.baySpacing;
		wall.add(buildSideColumn(materials, tiles, wallX, inward, z));
	}

	for (let i = 0; i < bays; i++) {
		const z = -HALF_D + (i + 0.5) * HANGAR.baySpacing;

		// Recessed service panel behind the catwalk
		const panel = box(0.2, 7, 4.2, materials.darkMetal, tiles.metal);
		wall.add(place(panel, wallX + inward * 0.1, 8.5, z));

		wall.add(buildBalcony(materials, tiles, wallX, inward, z));

		if (i % 2 === 0) wall.add(buildCrate(materials, tiles, wallX + inward * 1.2, z - 0.9, inward));
		if (i % 3 === 1) wall.add(buildCrate(materials, tiles, wallX + inward * 1.2, z + 1.0, inward));
	}

	return wall;
}

function buildSideColumn(materials, tiles, wallX, inward, z) {
	const column = new THREE.Group();
	column.name = 'column';

	const base = box(1.8, 2.4, 2.0, materials.darkMetal, tiles.metal);
	column.add(place(base, wallX + inward * 0.9, 1.2, z));

	const shaft = box(1.2, H, 1.4, materials.wall, tiles.metal);
	column.add(place(shaft, wallX + inward * 0.6, H / 2, z));

	// Knee brace from the column top to the ceiling, leaning towards the centre
	const brace = box(0.5, 4, 0.6, materials.wall, tiles.metal);
	brace.rotation.z = -inward * 0.75;
	column.add(place(brace, wallX + inward * 2.0, H - 1.9, z));

	// Vertical lamp strip on the inner face, plus a small marker light on the base
	const faceX = wallX + inward * 1.2;
	const strip = box(0.08, 2.6, 0.22, materials.lampWarm);
	column.add(place(strip, faceX + inward * 0.04, 6, z));

	const marker = box(0.06, 0.25, 0.4, materials.lampWarm);
	column.add(place(marker, wallX + inward * 1.83, 1.4, z));

	return column;
}

function buildBalcony(materials, tiles, wallX, inward, z) {
	const balcony = new THREE.Group();
	balcony.name = 'balcony';

	const depth = 1.6;
	const length = 4.4;
	const deckY = 4.5;
	const edgeX = wallX + inward * (depth - 0.05);

	const deck = box(depth, 0.15, length, materials.darkMetal, tiles.metal);
	balcony.add(place(deck, wallX + inward * (depth / 2), deckY, z));

	const topRail = box(0.07, 0.07, length, materials.trim);
	balcony.add(place(topRail, edgeX, deckY + 1.0, z));

	const midRail = box(0.05, 0.05, length, materials.trim);
	balcony.add(place(midRail, edgeX, deckY + 0.55, z));

	for (const dz of [-length / 2 + 0.05, 0, length / 2 - 0.05]) {
		const post = box(0.07, 1.0, 0.07, materials.trim);
		balcony.add(place(post, edgeX, deckY + 0.5, z + dz));
	}

	// Downlight under the deck
	const lamp = box(0.9, 0.04, 0.25, materials.lampWarm);
	balcony.add(place(lamp, wallX + inward * 0.9, deckY - 0.1, z));

	return balcony;
}

function buildCrate(materials, tiles, x, z, inward) {
	const crate = new THREE.Group();
	crate.name = 'crate';

	const body = box(1.2, 1.0, 1.8, materials.darkMetal, tiles.metal);
	crate.add(place(body, x, 0.5, z));

	const lid = box(1.3, 0.12, 1.9, materials.wall, tiles.metal);
	crate.add(place(lid, x, 1.06, z));

	const light = box(0.03, 0.08, 0.7, materials.lampWarm);
	crate.add(place(light, x + inward * 0.61, 0.75, z));

	return crate;
}

/**
 * Back wall: three large panels with X bracing, columns between them and a kick plate with floor lights.
 */
function buildBackWall({ materials, tiles }) {
	const wall = new THREE.Group();
	wall.name = 'wall-back';

	const wallZ = -HALF_D;
	const panelWidth = 11;
	const panelHeight = 11;
	const panelY = 7;
	const thirds = W / 3;

	for (let i = 0; i < 3; i++) {
		const x = -W / 2 + thirds * (i + 0.5);

		const panel = box(panelWidth, panelHeight, 0.3, materials.darkMetal, tiles.metal);
		wall.add(place(panel, x, panelY, wallZ + 0.15));

		// Raised frame around the panel
		const frameThickness = 0.45;
		for (const dy of [-1, 1]) {
			const bar = box(panelWidth, frameThickness, 0.35, materials.wall, tiles.metal);
			wall.add(place(bar, x, panelY + (dy * (panelHeight - frameThickness)) / 2, wallZ + 0.4));
		}
		for (const dx of [-1, 1]) {
			const bar = box(frameThickness, panelHeight, 0.35, materials.wall, tiles.metal);
			wall.add(place(bar, x + (dx * (panelWidth - frameThickness)) / 2, panelY, wallZ + 0.4));
		}

		// X bracing spanning the inner area of the frame
		const inner = panelWidth - 2 * frameThickness;
		const diagonal = Math.hypot(inner, inner);
		for (const sign of [1, -1]) {
			const brace = box(diagonal, 0.4, 0.25, materials.wall, tiles.metal);
			brace.rotation.z = sign * Math.atan2(inner, inner);
			wall.add(place(brace, x, panelY, wallZ + 0.4));
		}

		// Floor-level lights under each panel
		for (const dx of [-3.5, 0, 3.5]) {
			const lamp = box(0.5, 0.12, 0.05, materials.lampWarm);
			wall.add(place(lamp, x + dx, 0.85, wallZ + 0.62));
		}
	}

	for (const x of [-W / 2 + thirds, -W / 2 + 2 * thirds]) {
		const column = box(1.4, H, 1.2, materials.wall, tiles.metal);
		wall.add(place(column, x, H / 2, wallZ + 0.6));

		const strip = box(0.22, 2.6, 0.08, materials.lampWarm);
		wall.add(place(strip, x, 6, wallZ + 1.24));
	}

	const kickPlate = box(W, 1.2, 0.6, materials.darkMetal, tiles.metal);
	wall.add(place(kickPlate, 0, 0.6, wallZ + 0.3));

	return wall;
}

/**
 * Ceiling structure: transverse beams at every bay, two longitudinal girders (future crane rails)
 * and rows of light panels between the beams.
 */
function buildCeiling({ materials, tiles }) {
	const ceiling = new THREE.Group();
	ceiling.name = 'ceiling';

	const bays = D / HANGAR.baySpacing;

	for (let i = 0; i <= bays; i++) {
		const z = Math.min(-HALF_D + i * HANGAR.baySpacing, HALF_D - 1);
		const beam = box(W, 1.0, 0.7, materials.darkMetal, tiles.metal);
		ceiling.add(place(beam, 0, H - 0.5, z));
	}

	for (const x of [-W / 4, W / 4]) {
		const girder = box(0.7, 0.8, D, materials.darkMetal, tiles.metal);
		ceiling.add(place(girder, x, H - 1.4, 0));
	}

	const lampGeometry = new THREE.BoxGeometry(0.3, 0.06, 1.8);
	for (let i = 0; i < bays; i++) {
		const z = -HALF_D + (i + 0.5) * HANGAR.baySpacing;
		for (const x of [-14, -5, 5, 14]) {
			const lamp = new THREE.Mesh(lampGeometry, materials.lampWarm);
			ceiling.add(place(lamp, x, H - 0.05, z));
		}
	}

	return ceiling;
}

/**
 * Frame around the open front: two jambs with cyan edge lights and a header beam.
 */
function buildFrontFrame({ materials, tiles }) {
	const frame = new THREE.Group();
	frame.name = 'front-frame';

	const frameZ = HALF_D - 1;
	const jambWidth = 2.5;
	const headerHeight = 3;

	for (const side of [1, -1]) {
		const jamb = box(jambWidth, H, 2, materials.wall, tiles.metal);
		frame.add(place(jamb, side * (HALF_W - jambWidth / 2), H / 2, frameZ));

		const edgeLight = box(0.06, H - headerHeight - 1, 0.15, materials.lampCool);
		frame.add(place(edgeLight, side * (HALF_W - jambWidth - 0.03), (H - headerHeight) / 2, frameZ + 0.7));
	}

	const header = box(W, headerHeight, 2, materials.darkMetal, tiles.metal);
	frame.add(place(header, 0, H - headerHeight / 2, frameZ));

	const headerLight = box(W - 2 * jambWidth, 0.06, 0.15, materials.lampCool);
	frame.add(place(headerLight, 0, H - headerHeight - 0.03, frameZ + 0.7));

	return frame;
}

/**
 * Yellow safety lines painted on the floor: one along each side wall and one at the edge of the opening.
 */
function buildFloorMarkings({ materials }) {
	const markings = new THREE.Group();
	markings.name = 'floor-markings';

	const lineWidth = 0.18;
	const lineHeight = 0.01;
	const sideInset = 3.2;

	for (const side of [1, -1]) {
		const line = box(lineWidth, lineHeight, D - 2, materials.trim);
		markings.add(place(line, side * (HALF_W - sideInset), lineHeight / 2, 0));
	}

	const front = box(W - 2 * sideInset, lineHeight, lineWidth, materials.trim);
	markings.add(place(front, 0, lineHeight / 2, HALF_D - 2.5));

	return markings;
}

function buildLights() {
	const lights = new THREE.Group();
	lights.name = 'hangar-lights';

	lights.add(new THREE.HemisphereLight(0xa8b8d0, 0x2a2420, 0.6));

	// Ceiling lights over the central floor
	for (const x of [-8, 8]) {
		for (const z of [-18, -6, 6, 18]) {
			const light = new THREE.PointLight(0xffd2a0, 110, 0, 2);
			lights.add(place(light, x, H - 2.5, z));
		}
	}

	// Warm wash along the side walls, matching the column lamp strips
	for (const x of [-HALF_W + 2.5, HALF_W - 2.5]) {
		for (const z of [-15, 0, 15]) {
			const light = new THREE.PointLight(0xffc080, 60, 16, 2);
			lights.add(place(light, x, 6, z));
		}
	}

	return lights;
}
