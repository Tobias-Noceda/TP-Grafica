import * as THREE from 'three';

import { roundedRectangle } from '../../geometry/curves.js';
import { buildVariableSweepGeometry } from '../../geometry/sweep.js';
import { HARDPOINT_SPAN, ROOT_CENTER_Z, ROOT_CHORD, addTopHardpoint, buildFairing } from './common.js';

const defaults = { span: 4 };

/**
 * X-wing inspired S-foils: an upper and a lower flat, squared panel hinged at the root that open into an "X".
 */
export const xWingSFoils = {
	label: 'X-wing S-foils',
	opens: true,
	defaults,
	paramSchema: {
		span: { label: 'Span', min: 3.2, max: 5, step: 0.05 },
	},
	build: buildXWing,
};

const HINGE = { x: 0.12, y: 0.22 }; // hinge pins, relative to the fuselage socket
const OPEN_ANGLE = THREE.MathUtils.degToRad(14);

// Squared panel: root and tip sections as { lead, trail, half } (leading/trailing edge z, half thickness)
const PANEL_ROOT = { lead: 0.8, trail: -1.2, half: 0.08 };
const PANEL_TIP = { lead: 0.5, trail: -1.0, half: 0.04 };
const PANEL_STRIPE = [0.6, 0.75]; // red band, as span fractions
const EDGE_ROUND = 0.5; // section corner radius, as a fraction of the local half thickness

/**
 * No fixed engines or cannons; instead the upper panel carries a hardpoint on its top surface near the fuselage.
 *
 * Each panel is a variable-shape sweep (see `buildPanelGeometries`): a squared section with softened edges whose chord
 * and thickness taper at different rates from root to tip. The geometric param `span` rebuilds it.
 *
 * Hierarchy: wing → hinge fairing + pins, upperHinge / lowerHinge (rotate about z) → panel meshes, plus the hardpoint
 * socket and its pad cover on the upper hinge, so mounted parts follow the panel.
 */
function buildXWing(params, materials) {
	const { span } = { ...defaults, ...params };

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

	const pieces = buildPanelGeometries(span).map(({ geometry, material }) => ({
		geometry,
		material: materials[material],
	}));

	const upperHinge = buildHinge(pieces, HINGE.y);
	upperHinge.name = 'upper-hinge';
	wing.add(upperHinge);

	// The lower panel is the upper one flipped upside down, so the open wings form a symmetric X
	const lowerHinge = buildHinge(pieces, -HINGE.y);
	lowerHinge.name = 'lower-hinge';
	lowerHinge.children[0].scale.y = -1;
	wing.add(lowerHinge);

	const hardpoint = panelSection(HARDPOINT_SPAN / span);
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
	for (const { geometry, material } of pieces) {
		const mesh = new THREE.Mesh(geometry, material);
		// Tagged so the part viewer can show the technique on its own
		mesh.userData.technique = 'variableSweep';
		panel.add(mesh);
	}
	hinge.add(panel);

	return hinge;
}

/**
 * Panel section at span fraction t: { lead, trail, half }, lerped root → tip.
 */
function panelSection(t) {
	const lerp = (key) => THREE.MathUtils.lerp(PANEL_ROOT[key], PANEL_TIP[key], t);
	return { lead: lerp('lead'), trail: lerp('trail'), half: lerp('half') };
}

/**
 * Panel surfaces, from the hinge (x = 0) to the tip (x = span): one variable-shape sweep along a straight `LineCurve3`
 * on +x, split into material runs (white, red band, white) with `vStart`/`vEnd` so the sections match at the
 * boundaries; the root and tip runs get the end caps.
 *
 * The section is a `roundedRectangle` (chord along z, thickness along y) with corner radius `EDGE_ROUND` × half
 * thickness. Chord (2.0 → 1.5 m), its centre and thickness (0.16 → 0.08 m) change at different rates, so the section
 * shape changes along the span, not just its scale. Frames use `up` = +y: section x ↦ -z, section y ↦ +y.
 */
function buildPanelGeometries(span) {
	const shapeAt = (v) => {
		const { lead, trail, half } = panelSection(v);
		const center = new THREE.Vector2(-(lead + trail) / 2, 0);
		return roundedRectangle((lead - trail) / 2, half, EDGE_ROUND * half, center);
	};
	const path = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(span, 0, 0));
	const [s0, s1] = PANEL_STRIPE;
	const runs = [
		{ from: 0, to: s0, material: 'hullPaint', caps: { start: true, end: false } },
		{ from: s0, to: s1, material: 'hullRed', caps: { start: false, end: false } },
		{ from: s1, to: 1, material: 'hullPaint', caps: { start: false, end: true } },
	];
	return runs.map(({ from, to, material, caps }) => ({
		material,
		geometry: buildVariableSweepGeometry({
			shapeAt,
			path,
			segmentsPerCurve: 3,
			levels: Math.max(2, Math.round((to - from) * 12)),
			vStart: from,
			vEnd: to,
			caps,
			up: new THREE.Vector3(0, 1, 0),
		}),
	}));
}
