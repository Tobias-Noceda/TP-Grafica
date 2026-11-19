import * as THREE from 'three';

import { bezierChain2 } from '../../geometry/curves.js';
import { buildRevolutionGeometry } from '../../geometry/sweep.js';
import { buildEngineNacelle } from './common.js';

const defaults = { length: 0.9, nozzleFlare: 1 };

/**
 * X-wing style engine: full size on the tail plate (`rear`) or lying on two holders behind the cockpit (`top`,
 * one engine shared by both sockets); smaller, one per wing (`wing`).
 */
export const rearEngine = {
	label: 'Engine',
	hardpoints: ['rear', 'top', 'wing'],
	defaults,
	paramSchema: {
		length: { label: 'Length', min: 0.7, max: 1.3, step: 0.05 },
		nozzleFlare: { label: 'Nozzle flare', min: 0.9, max: 1.2, step: 0.01 },
	},
	build: buildRearEngine,
};

// Nacelle radius below the axis that must clear the hull (intake teeth), and the gap left under it
const BELLY = 0.5;
const GAP = 0.1;
const HOLDER = { width: 0.08, depthRatio: 0.5 };
// Engines on the wing hardpoint are scaled down to fit between the hull and the TIE wing flare (radius ≤ 0.27 m)
export const WING_SCALE = 0.45;

/**
 * The shared engine nacelle (see `buildEngineNacelle` in `common.js`), built around its local +y.
 *
 * - Rear socket (`outward` not up, -z on the ship): nacelle turned so +y follows `outward`, with its adapter plate over
 *   the tail plate. For outward -z, local z ends up along the ship's +y.
 * - Top and wing sockets (`outward` +y): the engine lies on a holder, nozzle backwards (-z), centred over the socket,
 *   with a Bézier-revolution nose cone closing the intake. When the socket has a pair (`toPairCentre`, top
 *   hardpoint), both sockets build a holder but only the left one builds the engine, at the pair centre, so the two
 *   holders carry one engine. Wing sockets have no pair: one engine per wing, scaled by `WING_SCALE` (radius ≤ 0.27 m)
 *   so it fits between the hull and the TIE wing flare.
 */
function buildRearEngine(params, materials, { outward = new THREE.Vector3(0, 0, -1), side = 'C', toPairCentre } = {}) {
	const { length, nozzleFlare } = { ...defaults, ...params };
	const normal = outward.clone().normalize();

	const engine = new THREE.Group();
	engine.name = 'rear-engine';

	// Any socket normal other than up (rear plate, or the part viewer's +z) mounts the engine along it
	if (Math.abs(normal.y) < 0.5) {
		const nacelle = buildEngineNacelle({ length, nozzleFlare }, materials);
		nacelle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
		engine.add(nacelle);
		return engine;
	}

	// Top pair (has `toPairCentre`): full size. Wing: scaled down, `length` stays in metres.
	const scale = toPairCentre ? 1 : WING_SCALE;
	const axisHeight = GAP + BELLY * scale;
	const holder = new THREE.Mesh(
		new THREE.BoxGeometry(HOLDER.width, axisHeight + 0.04, HOLDER.depthRatio * length),
		materials.hullDark
	);
	holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
	holder.position.copy(normal).multiplyScalar(axisHeight / 2 - 0.02);
	engine.add(holder);

	// The right socket of a pair only holds the engine built by the left one
	if (toPairCentre && side === 'R') return engine;

	const nacelle = buildEngineNacelle({ length: length / scale, nozzleFlare }, materials, { adapter: false });
	nacelle.add(
		new THREE.Mesh(
			buildRevolutionGeometry({ profile: noseProfile(), segmentsPerCurve: 12, radialSegments: 48 }),
			materials.hullPaint
		)
	);
	nacelle.scale.setScalar(scale);
	nacelle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
	nacelle.position
		.copy(normal)
		.multiplyScalar(axisHeight)
		.add(new THREE.Vector3(0, 0, length / 2));
	if (toPairCentre) nacelle.position.add(toPairCentre);
	engine.add(nacelle);

	return engine;
}

/**
 * Nose cone in front of the intake neck (radius 0.3 at y = 0): from the tip on the axis to the neck, one cubic
 * Bézier, flat at the tip (rounded) and tangent to the neck at the end (C1 with it).
 */
function noseProfile() {
	const v = (x, y) => new THREE.Vector2(x, y);
	return bezierChain2([v(0, -0.35), v(0.2, -0.35), v(0.3, -0.22), v(0.3, 0)]);
}
