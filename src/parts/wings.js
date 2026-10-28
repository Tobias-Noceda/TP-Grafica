import * as THREE from 'three';

import { bezierChain2 } from '../geometry/curves.js';
import { levelMatrices } from '../geometry/frames.js';
import { buildVariableSweepGeometry } from '../geometry/sweep.js';
import { buildPadCover } from './sockets.js';

/**
 * Wing variants. Each `build(params, materials)` returns one side's wing set for the fuselage `socket_wing_*`, built
 * for the left side (+x outwards, +z forward, +y up); the right copy is mirrored by `mountPart`.
 *
 * `userData` exposes `sockets` (hardpoints the wing offers to weapons/thrusters, see `app/loadout.js`) and, for wings
 * that move (`opens: true`), `setOpen(t)` with t ∈ [0, 1].
 */
export const wingVariants = {
	xwing: {
		label: 'X-wing S-foils',
		opens: true,
		defaults: { span: 4 },
		paramSchema: {
			span: { label: 'Span', min: 3.2, max: 5, step: 0.05 },
		},
		build: buildXWing,
	},
	plane: {
		label: 'Plane wing',
		opens: false,
		defaults: { span: 4, tipChord: 1.0, sweep: 0.6, rootThickness: 0.13 },
		paramSchema: {
			span: { label: 'Span', min: 3.2, max: 5, step: 0.05 },
			tipChord: { label: 'Tip chord', min: 0.6, max: 1.6, step: 0.05 },
			sweep: { label: 'Sweep back', min: 0, max: 1.2, step: 0.05 },
			rootThickness: { label: 'Root thickness', min: 0.08, max: 0.2, step: 0.01 },
		},
		build: buildPlaneWing,
	},
};

const ROOT_CHORD = 2.0;
const ROOT_CENTER_Z = -0.2; // chord centre at the root, relative to the fuselage socket
const HARDPOINT_SPAN = 0.9; // distance from the root to the top hardpoint
const PAD_RADIUS = 0.15;

// --- X-wing S-foils ---------------------------------------------------------------------------------------------

const HINGE = { x: 0.12, y: 0.22 }; // hinge pins, relative to the fuselage socket
const OPEN_ANGLE = THREE.MathUtils.degToRad(14);

// Squared slab panel: root and tip sections as { lead, trail, half } (leading/trailing edge z, half thickness)
const SLAB_ROOT = { lead: 0.8, trail: -1.2, half: 0.08 };
const SLAB_TIP = { lead: 0.5, trail: -1.0, half: 0.04 };
const SLAB_STRIPE = [0.6, 0.75]; // red band, as span fractions

/**
 * X-wing inspired S-foils: an upper and a lower flat, squared panel hinged at the root that open into an "X". No fixed
 * engines or cannons; instead the upper panel carries a hardpoint on its top surface near the fuselage.
 *
 * Built only from primitives: each panel is a `slab` (a `BoxGeometry` with its corners moved), so no surface technique
 * is used here. The geometric param `span` rebuilds the slabs.
 *
 * Hierarchy: wing → hinge fairing + pins, upperHinge / lowerHinge (rotate about z) → panel meshes, plus the hardpoint
 * socket and its pad cover on the upper hinge, so mounted parts follow the panel.
 */
function buildXWing(params, materials) {
	const { span } = { ...wingVariants.xwing.defaults, ...params };

	const wing = new THREE.Group();
	wing.name = 'xwing-wing';
	wing.add(buildFairing(materials, 0.74));

	// Chrome hinge pins along z: the visible joints the panels rotate about
	const pinGeometry = new THREE.CylinderGeometry(0.05, 0.05, ROOT_CHORD * 0.9, 16);
	for (const y of [HINGE.y, -HINGE.y]) {
		const pin = new THREE.Mesh(pinGeometry, materials.chrome);
		pin.rotation.x = Math.PI / 2;
		pin.position.set(HINGE.x, y, ROOT_CENTER_Z);
		wing.add(pin);
	}

	const section = (t, margin = 0) => {
		const lerp = (key) => THREE.MathUtils.lerp(SLAB_ROOT[key], SLAB_TIP[key], t);
		return { lead: lerp('lead') + margin, trail: lerp('trail') - margin, half: lerp('half') + margin };
	};
	const [s0, s1] = SLAB_STRIPE;
	const pieces = [
		{ geometry: slab(section(0), section(1), 0, span), material: materials.hullPaint },
		{
			geometry: slab(section(s0, 0.008), section(s1, 0.008), s0 * span, s1 * span),
			material: materials.hullRed,
		},
	];

	const upperHinge = buildHinge(pieces, HINGE.y);
	upperHinge.name = 'upper-hinge';
	wing.add(upperHinge);

	// The lower panel is the upper one flipped upside down, so the open wings form a symmetric X
	const lowerHinge = buildHinge(pieces, -HINGE.y);
	lowerHinge.name = 'lower-hinge';
	lowerHinge.children[0].scale.y = -1;
	wing.add(lowerHinge);

	const hardpoint = section(HARDPOINT_SPAN / span);
	const socket = addTopHardpoint(
		upperHinge,
		new THREE.Vector3(HARDPOINT_SPAN, hardpoint.half, (hardpoint.lead + hardpoint.trail) / 2),
		materials
	);

	wing.userData = {
		sockets: { top: socket },
		setOpen: (t) => {
			upperHinge.rotation.z = t * OPEN_ANGLE;
			lowerHinge.rotation.z = -t * OPEN_ANGLE;
		},
	};

	return wing;
}

/**
 * Hinge group at the root, holding one panel built from the shared piece geometries.
 */
function buildHinge(pieces, y) {
	const hinge = new THREE.Group();
	hinge.position.set(HINGE.x, y, 0);

	const panel = new THREE.Group();
	panel.name = 'panel';
	for (const { geometry, material } of pieces) panel.add(new THREE.Mesh(geometry, material));
	hinge.add(panel);

	return hinge;
}

/**
 * Flat wing slab from x0 (root side) to x1 (tip side): a `BoxGeometry` whose corners are moved to the given sections.
 * Each face stays planar (the leading and trailing edge faces are symmetric in y, top and bottom contain the z edges),
 * and every face keeps its own vertices, so the normals are flat.
 */
function slab(root, tip, x0, x1) {
	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const position = geometry.attributes.position;

	for (let i = 0; i < position.count; i++) {
		const isTip = position.getX(i) > 0;
		const section = isTip ? tip : root;
		position.setXYZ(
			i,
			isTip ? x1 : x0,
			Math.sign(position.getY(i)) * section.half,
			position.getZ(i) > 0 ? section.lead : section.trail
		);
	}
	geometry.computeVertexNormals();

	return geometry;
}

// --- Plane wing -------------------------------------------------------------------------------------------------

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
 * Plane-like wing: one fixed panel per side with a small dihedral. The panel is a variable-shape sweep: an airfoil
 * section (see `airfoilAt`) that changes shape along a Bézier span path curving backwards by `sweep`, so its sections
 * are also oriented along a curved path. All four params rebuild the geometry.
 */
function buildPlaneWing(params, materials) {
	const { span, tipChord, sweep, rootThickness } = { ...wingVariants.plane.defaults, ...params };

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

// --- Shared ---------------------------------------------------------------------------------------------------------

/**
 * Dark root fairing against the hull, `height` tall.
 */
function buildFairing(materials, height) {
	const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.16, height, ROOT_CHORD * 0.85), materials.hullDark);
	fairing.name = 'root-fairing';
	fairing.position.set(0.06, 0, ROOT_CENTER_Z);
	return fairing;
}

/**
 * Top hardpoint on a panel: socket + round pad cover, both children of `parent` so mounted parts follow it. The wing
 * itself is already mirrored on the right, so the socket stays 'L' (no second mirror).
 */
function addTopHardpoint(parent, position, materials) {
	const socket = new THREE.Object3D();
	socket.name = 'socket_wing_top';
	socket.position.copy(position);
	socket.userData = { side: 'L', outward: new THREE.Vector3(0, 1, 0) };
	socket.userData.cover = buildPadCover(materials, socket.position, PAD_RADIUS);
	parent.add(socket, socket.userData.cover);
	return socket;
}
