import * as THREE from 'three';

import { bezierChain2, roundedRectangle } from '../../geometry/curves.js';
import { buildRevolutionGeometry, buildVariableSweepGeometry } from '../../geometry/sweep.js';
import { radialRing } from './common.js';

const defaults = { length: 0.8, roundness: 1, nozzleFlare: 1.05, gap: 0.04 };

/**
 * Quad block: a 2×2 block of square engines covering the tail, only allowed on the centre `rear` hardpoint. Each
 * nozzle morphs from a square into a rounded square / circle (variable-shape sweep).
 */
export const quadBlock = {
	label: 'Quad block',
	hardpoints: ['rear'],
	defaults,
	paramSchema: {
		length: { label: 'Length', min: 0.6, max: 1.1, step: 0.05 },
		roundness: { label: 'Exit roundness', min: 0, max: 1, step: 0.05 },
		nozzleFlare: { label: 'Nozzle flare', min: 0.9, max: 1.2, step: 0.01 },
		gap: { label: 'Cell gap', min: 0.02, max: 0.08, step: 0.005 },
	},
	build: buildQuadBlock,
};

// Whole block (frame included) as half sizes across the tail: x = ship width, z = ship height (nacelle axes)
const BLOCK = { halfWidth: 0.55, halfHeight: 0.4 };
const FRAME = 0.04; // frame bar thickness around the four cells
const PLATE = 0.05; // mounting plate depth on the tail
const FRAME_DEPTH = PLATE + 0.17; // how far the frame reaches back along the engines
// Along each cell, from the hull: intake (square, widening), casing (constant square), nozzle (square → round)
const INTAKE = 0.1;
const NOZZLE = 0.3;
const THROAT_DEPTH = 0.15; // glowing core depth inside the nozzle exit
const MIN_CORNER = 0.006; // corner radius of the "square" sections: > 0 so the corner arcs keep a tangent

/**
 * Four square engines in a 2×2 grid inside a shared dark frame, pointing along `outward` (-z on the rear socket).
 *
 * Built around the local +y (engine axis) in `nacelle`, turned so +y follows `outward`; the cells sit on the local
 * x/z grid (ship x/y on the rear socket). One cell's geometries are built once and shared by the four meshes.
 *
 * Each cell is one variable-shape sweep of a `roundedRectangle` along a straight `LineCurve3`, split into material
 * runs (intake, casing, nozzle) with `vStart`/`vEnd` so the sections match at the boundaries. The section is a
 * rectangle with tiny corners until the nozzle, then the corners grow and the sides even out into a rounded square or
 * circle at the exit (`roundness`, `nozzleFlare`). Body: plate, frame, intake, casing with a dark rib and a red
 * stripe. Exhaust: the morphing nozzle, a white lip face, a dark cone of petals to a glowing core with blades.
 */
function buildQuadBlock(params, materials, { outward = new THREE.Vector3(0, 0, -1) } = {}) {
	const { length, roundness, nozzleFlare, gap } = { ...defaults, ...params };

	const block = new THREE.Group();
	block.name = 'quad-block';

	const nacelle = new THREE.Group();
	nacelle.name = 'nacelle';
	nacelle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward.clone().normalize());
	block.add(nacelle);

	// Cell half sizes: two cells and the gap fill the inside of the frame
	const innerX = BLOCK.halfWidth - FRAME;
	const innerZ = BLOCK.halfHeight - FRAME;
	const cell = { a: (innerX - gap / 2) / 2, b: (innerZ - gap / 2) / 2 };
	const exit = exitSection(cell, gap, roundness, nozzleFlare);

	const cellMeshes = buildCell(cell, exit, length, gap, materials);
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			for (const mesh of cellMeshes) {
				const copy = mesh.clone(); // shares geometry and material
				copy.position.x += sx * (cell.a + gap / 2);
				copy.position.z += sz * (cell.b + gap / 2);
				nacelle.add(copy);
			}
		}
	}

	nacelle.add(buildFrame(gap, materials));

	return block;
}

/**
 * Exit section of a nozzle: the half sizes even out towards the cell height (a circle when `roundness` = 1), scaled by
 * `flare` but kept inside the cell slot so neighbouring nozzles never touch. The corner radius grows with
 * `roundness`, always a little under the smaller half size so the straight sides never reach zero length.
 */
function exitSection({ a, b }, gap, roundness, flare) {
	const slotX = a + gap / 2 - 0.005;
	const slotZ = b + gap / 2 - 0.005;
	const halfWidth = Math.min(THREE.MathUtils.lerp(a, b, roundness) * flare, slotX);
	const halfHeight = Math.min(b * flare, slotZ);
	const smaller = Math.min(halfWidth, halfHeight);
	const radius = THREE.MathUtils.clamp(roundness * smaller, MIN_CORNER, smaller - 0.008);
	return { halfWidth, halfHeight, radius };
}

/**
 * Meshes of one cell centred on its axis (nacelle +y, from the hull at y = 0 to the exit at y = length).
 */
function buildCell({ a, b }, exit, length, gap, materials) {
	const meshes = [];
	const intakeEnd = PLATE + INTAKE;
	const bodyEnd = length - NOZZLE;

	// Section at height y along the cell: intake widens to the casing, casing constant, nozzle morphs to the exit
	const sectionAt = (y) => {
		if (y <= intakeEnd) {
			const t = THREE.MathUtils.clamp((y - PLATE) / INTAKE, 0, 1);
			return roundedRectangle(a - 0.03 * (1 - t), b - 0.03 * (1 - t), MIN_CORNER);
		}
		if (y <= bodyEnd) return roundedRectangle(a, b, MIN_CORNER);
		const s = THREE.MathUtils.smoothstep((y - bodyEnd) / NOZZLE, 0, 1);
		return roundedRectangle(
			THREE.MathUtils.lerp(a, exit.halfWidth, s),
			THREE.MathUtils.lerp(b, exit.halfHeight, s),
			THREE.MathUtils.lerp(MIN_CORNER, exit.radius, s)
		);
	};

	// Straight path along +y; `up` = +z keeps the section's y on the nacelle z (ship up on the rear socket)
	const path = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, length, 0));
	const up = new THREE.Vector3(0, 0, 1);
	const runs = [
		{ from: 0, to: intakeEnd, levels: 4, material: 'hullDark' },
		{ from: intakeEnd, to: bodyEnd, levels: 2, material: 'hullPaint' },
		{ from: bodyEnd, to: length, levels: 16, material: 'hullPaint' },
	];
	for (const { from, to, levels, material } of runs) {
		const geometry = buildVariableSweepGeometry({
			shapeAt: (v) => sectionAt(v * length),
			path,
			segmentsPerCurve: 4,
			levels,
			vStart: from / length,
			vEnd: to / length,
			caps: { start: false, end: false },
			up,
		});
		const mesh = new THREE.Mesh(geometry, materials[material]);
		// Tagged so the part viewer can show the technique on its own
		mesh.userData.technique = 'variableSweep';
		meshes.push(mesh);
	}

	// Raised bands around the casing: a dark rib after the intake and a red stripe before the nozzle
	const raise = Math.min(0.012, gap / 2 - 0.003);
	const bands = [
		{ y: intakeEnd + 0.02, width: 0.03, material: 'hullDark' },
		{ y: bodyEnd - 0.07, width: 0.04, material: 'hullRed' },
	];
	for (const { y, width, material } of bands) {
		const section = roundedRectangle(a + raise, b + raise, MIN_CORNER + raise);
		const geometry = buildVariableSweepGeometry({
			shapeAt: () => section,
			path: new THREE.LineCurve3(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y + width, 0)),
			segmentsPerCurve: 2,
			levels: 1,
			caps: { start: true, end: true },
			up,
		});
		meshes.push(new THREE.Mesh(geometry, materials[material]));
	}

	// Exit lip: flat face filling the nozzle exit, with a round hole for the throat
	const throatRadius = 0.75 * Math.min(exit.halfWidth, exit.halfHeight);
	const lip = new THREE.Shape(roundedRectangle(exit.halfWidth, exit.halfHeight, exit.radius).getPoints(6));
	lip.holes.push(new THREE.Path().absarc(0, 0, throatRadius, 0, 2 * Math.PI, true));
	const lipGeometry = new THREE.ShapeGeometry(lip, 24);
	lipGeometry.rotateX(-Math.PI / 2); // shape plane (normal +z) → exit plane (normal +y)
	lipGeometry.translate(0, length, 0);
	meshes.push(new THREE.Mesh(lipGeometry, materials.hullPaint));

	// Throat: cone narrowing into the nozzle to a small glowing core (revolutions around the cell axis)
	const coreRadius = 0.3 * throatRadius;
	const coreY = length - THROAT_DEPTH;
	const v = (x, y) => new THREE.Vector2(x, y);
	const coneOuter = v(throatRadius, length);
	const coneInner = v(coreRadius, coreY);
	const cone = bezierChain2([
		coneOuter,
		v(throatRadius * 0.85, length - 0.06),
		v(coreRadius * 1.2, coreY + 0.03),
		coneInner,
	]);
	const core = bezierChain2([coneInner, v(coreRadius * 0.66, coreY), v(coreRadius * 0.33, coreY), v(0, coreY)]);
	meshes.push(
		new THREE.Mesh(
			buildRevolutionGeometry({ profile: cone, segmentsPerCurve: 10, radialSegments: 32 }),
			materials.hullDark
		)
	);
	meshes.push(
		new THREE.Mesh(
			buildRevolutionGeometry({ profile: core, segmentsPerCurve: 2, radialSegments: 32 }),
			materials.exhaust
		)
	);

	// Petals lining the cone (lifted off it so the gaps read as seams) and blades in front of the core
	const slant = new THREE.Vector2(coneOuter.x - coneInner.x, coneOuter.y - coneInner.y);
	const mid = coneInner.clone().add(coneOuter).multiplyScalar(0.5);
	const lift = new THREE.Vector2(-slant.y, slant.x).normalize().multiplyScalar(0.006);
	meshes.push(
		new THREE.Mesh(
			radialRing(12, mid.x + lift.x, mid.y + lift.y, [0.008, slant.length() * 0.85, 0.03], {
				z: -Math.atan2(slant.x, slant.y),
			}),
			materials.hullPaint
		)
	);
	meshes.push(
		new THREE.Mesh(
			radialRing(6, coreRadius * 0.6, coreY + 0.03, [coreRadius * 1.1, 0.025, 0.006], { x: 0.6 }),
			materials.hullDark
		)
	);

	return meshes;
}

/**
 * Mounting plate on the tail, dark frame around the four cells (outer bars and a cross in the gaps) and chrome bolts
 * on the frame's rear face. Merged-free primitives: they are details.
 */
function buildFrame(gap, materials) {
	const frame = new THREE.Group();
	frame.name = 'frame';
	const { halfWidth: W, halfHeight: H } = BLOCK;
	const box = (sx, sy, sz, x, y, z, material = materials.hullDark) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
		mesh.position.set(x, y, z);
		frame.add(mesh);
		return mesh;
	};

	box(2 * W + 0.04, PLATE, 2 * H + 0.04, 0, PLATE / 2, 0);

	const barY = PLATE + (FRAME_DEPTH - PLATE) / 2;
	const barDepth = FRAME_DEPTH - PLATE;
	for (const side of [-1, 1]) {
		box(FRAME, barDepth, 2 * H, side * (W - FRAME / 2), barY, 0);
		box(2 * W, barDepth, FRAME, 0, barY, side * (H - FRAME / 2));
	}
	box(gap, barDepth, 2 * H, 0, barY, 0);
	box(2 * W, barDepth, gap, 0, barY, 0);

	const boltGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.016, 10);
	for (const x of [-1, 0, 1]) {
		for (const z of [-1, 1]) {
			const bolt = new THREE.Mesh(boltGeometry, materials.chrome);
			bolt.position.set(x * (W - FRAME / 2), FRAME_DEPTH + 0.008, z * (H - FRAME / 2));
			frame.add(bolt);
		}
	}

	return frame;
}
