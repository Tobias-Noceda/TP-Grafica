import * as THREE from 'three';

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

// Squared slab panel: root and tip sections as { lead, trail, half } (leading/trailing edge z, half thickness)
const SLAB_ROOT = { lead: 0.8, trail: -1.2, half: 0.08 };
const SLAB_TIP = { lead: 0.5, trail: -1.0, half: 0.04 };
const SLAB_STRIPE = [0.6, 0.75]; // red band, as span fractions

/**
 * No fixed engines or cannons; instead the upper panel carries a hardpoint on its top surface near the fuselage.
 *
 * Built only from primitives: each panel is a `slab` (a `BoxGeometry` with its corners moved), so no surface technique
 * is used here. The geometric param `span` rebuilds the slabs.
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
