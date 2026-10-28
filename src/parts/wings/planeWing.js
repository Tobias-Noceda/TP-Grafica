import * as THREE from 'three';

import { bezierChain2 } from '../../geometry/curves.js';
import { levelMatrices } from '../../geometry/frames.js';
import { buildVariableSweepGeometry } from '../../geometry/sweep.js';
import { HARDPOINT_SPAN, ROOT_CHORD, addTopHardpoint, buildFairing } from './common.js';

const defaults = { span: 4, tipChord: 1.0, sweep: 0.6, rootThickness: 0.13 };

/**
 * Plane-like wing: one fixed panel per side with a small dihedral.
 */
export const planeWing = {
	label: 'Plane wing',
	opens: false,
	defaults,
	paramSchema: {
		span: { label: 'Span', min: 3.2, max: 5, step: 0.05 },
		tipChord: { label: 'Tip chord', min: 0.6, max: 1.6, step: 0.05 },
		sweep: { label: 'Sweep back', min: 0, max: 1.2, step: 0.05 },
		rootThickness: { label: 'Root thickness', min: 0.08, max: 0.2, step: 0.01 },
	},
	build: buildPlaneWing,
};

const PLANE_ROOT_X = 0.1; // panel root, just outside the fairing
const PLANE_DIHEDRAL = THREE.MathUtils.degToRad(3);
const TIP_THICKNESS = 0.05; // thickness / chord at the tip
const ROOT_CAMBER = 0.03; // camber / chord at the root, flat at the tip

// Panel split along the span: white, red stripe, white
const PLANE_PIECES = [
	{ from: 0, to: 0.55, material: 'hullPaint' },
	{ from: 0.55, to: 0.68, material: 'hullRed' },
	{ from: 0.68, to: 1, material: 'hullPaint' },
];

/**
 * The panel is a variable-shape sweep: an airfoil section (see `airfoilAt`) that changes shape along a Bézier span
 * path curving backwards by `sweep`, so its sections are also oriented along a curved path. All four params rebuild
 * the geometry.
 */
function buildPlaneWing(params, materials) {
	const { span, tipChord, sweep, rootThickness } = { ...defaults, ...params };

	const wing = new THREE.Group();
	wing.name = 'plane-wing';
	wing.add(buildFairing(materials, ROOT_CHORD * rootThickness + 0.12));

	// Span path in the panel frame: leaves the root along +x and curves backwards (-z) to the tip
	const path = new THREE.CubicBezierCurve3(
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(span * 0.35, 0, 0),
		new THREE.Vector3(span * 0.7, 0, -sweep * 0.3),
		new THREE.Vector3(span, 0, -sweep)
	);
	const shapeAt = (v) => airfoilAt(v, tipChord, rootThickness);

	const panel = new THREE.Group();
	panel.name = 'panel';
	panel.position.x = PLANE_ROOT_X;
	panel.rotation.z = PLANE_DIHEDRAL;
	PLANE_PIECES.forEach(({ from, to, material }, index) => {
		const geometry = buildVariableSweepGeometry({
			shapeAt,
			path,
			segmentsPerCurve: 14,
			levels: Math.max(2, Math.ceil((to - from) * 48)),
			vStart: from,
			vEnd: to,
			caps: { start: index === 0, end: index === PLANE_PIECES.length - 1 },
		});
		panel.add(new THREE.Mesh(geometry, materials[material]));
	});
	wing.add(panel);

	const socketV = HARDPOINT_SPAN / path.getLength();
	const [frame] = levelMatrices(path, [socketV], { method: 'up' });
	const at = new THREE.Vector3(0, upperSurfaceAt(shapeAt(socketV), 0), 0).applyMatrix4(frame);
	const socket = addTopHardpoint(panel, at, materials);

	wing.userData = { sockets: { top: socket } };

	return wing;
}

/**
 * Airfoil section at span fraction v, as a closed CCW chain of two cubic Béziers in section coordinates (x along the
 * chord, pointing backwards since the frame's N is -z; y up): upper surface trailing edge → leading edge, lower surface
 * leading edge → trailing edge. The leading edge is round (C1: both control points on the vertical through it) and
 * the trailing edge is a sharp knot.
 *
 * Along the span the chord tapers to `tipChord`, but the thickness ratio also drops from `rootThickness` to
 * TIP_THICKNESS and the camber flattens out, so the section changes shape, not only size.
 */
function airfoilAt(v, tipChord, rootThickness) {
	const chord = THREE.MathUtils.lerp(ROOT_CHORD, tipChord, v);
	const half = (chord * THREE.MathUtils.lerp(rootThickness, TIP_THICKNESS, v)) / 2;
	const camber = chord * THREE.MathUtils.lerp(ROOT_CAMBER, 0, v);

	const leading = -0.4 * chord;
	const trailing = 0.6 * chord;
	const nose = camber * 0.3;
	const mid = trailing - 0.5 * chord;
	const p = (x, y) => new THREE.Vector2(x, y);

	return bezierChain2([
		// Upper surface
		p(trailing, 0),
		p(mid, camber + 1.25 * half),
		p(leading, nose + 0.95 * half),
		p(leading, nose),
		// Lower surface
		p(leading, nose - 0.75 * half),
		p(mid, camber * 0.5 - 0.9 * half),
		p(trailing, 0),
	]);
}

/**
 * Height of the upper surface of a section at chord position x (section coordinates).
 */
function upperSurfaceAt(section, x) {
	const points = section.curves[0].getPoints(64);
	for (let i = 1; i < points.length; i++) {
		const [a, b] = [points[i - 1], points[i]];
		if ((a.x - x) * (b.x - x) <= 0) return THREE.MathUtils.lerp(a.y, b.y, (x - a.x) / (b.x - a.x || 1));
	}
	return Math.max(...points.map((point) => point.y));
}
