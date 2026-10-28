import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { bezierChain2 } from '../geometry/curves.js';
import { buildRevolutionGeometry } from '../geometry/sweep.js';

/**
 * Thruster variants. Each `build(params, materials, { outward })` returns a group whose origin is the attach point on
 * the hull, with the nozzle pointing along `outward` (the socket's hull normal). Every thruster has a clear **body**
 * and an **exhaust** zone. `hardpoints` (optional) restricts where a variant can be mounted (see `app/loadout.js`).
 */
export const thrusterVariants = {
	rearEngine: {
		label: 'Rear engine',
		hardpoints: ['rear'],
		defaults: { length: 0.9, nozzleFlare: 1 },
		paramSchema: {
			length: { label: 'Length', min: 0.7, max: 1.3, step: 0.05 },
			nozzleFlare: { label: 'Nozzle flare', min: 0.9, max: 1.2, step: 0.01 },
		},
		build: buildRearEngine,
	},
};

// Rear engine: casing radius and where the casing starts (behind the intake ring), along the engine axis
const ENGINE = { radius: 0.44, bodyStart: 0.28 };
// Waist + collar + converging nozzle, from the end of the casing to the exit
const NOZZLE_LENGTH = 0.3;
// Exit lip → petal cone → glowing core, going into the nozzle from the exit
const CORE = { radius: 0.14, depth: 0.22 };
// Mounting plate against the tail, wider than tall like the tail plate it covers
const ADAPTER = { width: 1.06, height: 0.76, depth: 0.08 };
// Bands along the casing, as fractions of its length: a dark groove and a raised red stripe
const BANDS = [
	{ at: 0.3, kind: 'groove' },
	{ at: 0.7, kind: 'stripe' },
];
const BAND_WIDTH = 0.07;

/**
 * Large single engine filling the tail, inspired by the X-wing engines but kept short so it barely protrudes: adapter
 * plate, intake ring with ribbed teeth, short casing with a groove and a red stripe (body), then a slatted collar, a
 * converging nozzle with a thick lip, and inside it a cone of petals converging to a small glowing core with a fan of
 * blades and a hub (exhaust).
 *
 * The casing, nozzle, petal cone, core and hub are surfaces of revolution of Bézier profiles (see `engineProfile`);
 * `length` and `nozzleFlare` rebuild them. Teeth, slats, petals, blades, plate and bolts are primitives.
 *
 * The engine is built around its local +y (the revolution axis) in `nacelle`, which is turned so +y follows
 * `outward`. For the rear socket (outward -z), local z ends up along the ship's +y.
 */
function buildRearEngine(params, materials, { outward = new THREE.Vector3(0, 0, -1) } = {}) {
	const { length, nozzleFlare } = { ...thrusterVariants.rearEngine.defaults, ...params };

	const engine = new THREE.Group();
	engine.name = 'rear-engine';

	const nacelle = new THREE.Group();
	nacelle.name = 'nacelle';
	nacelle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward.clone().normalize());
	engine.add(nacelle);

	const { runs, collar, cone, core } = engineProfile(length, nozzleFlare);
	for (const { material, profile } of runs) {
		nacelle.add(
			new THREE.Mesh(
				buildRevolutionGeometry({ profile, segmentsPerCurve: 8, radialSegments: 48 }),
				materials[material]
			)
		);
	}

	// Hub in the middle of the fan, its base sunk in the glowing bottom
	const hub = bezierChain2([
		new THREE.Vector2(0.045, core.y - 0.01),
		new THREE.Vector2(0.05, core.y + 0.04),
		new THREE.Vector2(0.04, core.y + 0.1),
		new THREE.Vector2(0, core.y + 0.12),
	]);
	nacelle.add(
		new THREE.Mesh(
			buildRevolutionGeometry({ profile: hub, segmentsPerCurve: 12, radialSegments: 32 }),
			materials.hullDark
		)
	);

	// Adapter plate over the tail plate, with chrome bolts on its rear face
	const adapter = new THREE.Mesh(
		new THREE.BoxGeometry(ADAPTER.width, ADAPTER.depth, ADAPTER.height),
		materials.hullDark
	);
	adapter.position.y = ADAPTER.depth / 2;
	nacelle.add(adapter);
	const boltGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12);
	for (const sx of [1, -1]) {
		for (const sz of [1, -1]) {
			const bolt = new THREE.Mesh(boltGeometry, materials.chrome);
			bolt.position.set(sx * (ADAPTER.width / 2 - 0.07), ADAPTER.depth + 0.01, sz * (ADAPTER.height / 2 - 0.07));
			nacelle.add(bolt);
		}
	}

	// Ribbed teeth around the intake ring and slats around the nozzle collar
	nacelle.add(new THREE.Mesh(radialRing(40, 0.482, 0.19, [0.03, 0.12, 0.025]), materials.gunMetal));
	nacelle.add(
		new THREE.Mesh(radialRing(28, collar.radius + 0.008, collar.y, [0.02, 0.1, 0.03]), materials.hullPaint)
	);

	// Petals lining the cone, laid along its slant and lifted just off the dark surface so the gaps read as seams
	const slant = new THREE.Vector2(cone.outer.x - cone.inner.x, cone.outer.y - cone.inner.y);
	const mid = cone.inner.clone().add(cone.outer).multiplyScalar(0.5);
	const lift = new THREE.Vector2(-slant.y, slant.x).normalize().multiplyScalar(0.012); // towards the axis and the exit
	nacelle.add(
		new THREE.Mesh(
			radialRing(24, mid.x + lift.x, mid.y + lift.y, [0.016, slant.length() * 0.9, 0.045], {
				z: -Math.atan2(slant.x, slant.y),
			}),
			materials.hullPaint
		)
	);

	// Fan blades in front of the glowing core
	nacelle.add(
		new THREE.Mesh(radialRing(12, 0.085, core.y + 0.05, [0.11, 0.05, 0.01], { x: 0.6 }), materials.hullDark)
	);

	return engine;
}

/**
 * Engine profile (x = radius, y = distance from the hull along the axis), a chain of cubic Béziers split into runs by
 * material so each run is its own revolution mesh:
 * neck → intake ring → casing with a groove and a raised stripe → waist → collar → converging nozzle → thick exit lip
 * → dark seam → petal cone narrowing inwards → glowing core bottom. Straight pieces are Béziers with control points at
 * thirds. The collar → nozzle join is C1; the other joins are sharp knots. `flare` scales the collar, exit and lip.
 *
 * The cone and the core bottom are drawn with decreasing y / radius, so they face the axis and the exit.
 */
function engineProfile(length, flare) {
	const v = (x, y) => new THREE.Vector2(x, y);
	const R = ENGINE.radius;
	const bodyEnd = length - NOZZLE_LENGTH;
	// Bands shrink on short casings so they never overlap
	const band = Math.min(BAND_WIDTH, 0.2 * (bodyEnd - ENGINE.bodyStart));
	const collarRadius = 0.49 * flare;
	const exit = 0.42 * flare;
	const lip = 0.33 * flare;
	const coneOuter = v(lip, length - 0.02);
	const core = { radius: CORE.radius, y: length - CORE.depth };

	// [material, end] is a straight piece, [material, c1, c2, end] a curved one
	const segments = [
		['hullDark', v(0.3, 0.1)],
		['hullPaint', v(0.47, 0.12)],
		['hullPaint', v(0.47, 0.26)],
		['hullPaint', v(R, ENGINE.bodyStart)],
	];
	for (const { at, kind } of BANDS) {
		const y = THREE.MathUtils.lerp(ENGINE.bodyStart, bodyEnd - band, at);
		segments.push(['hullPaint', v(R, y)]);
		if (kind === 'groove') {
			segments.push(
				['hullDark', v(R - 0.03, y + band * 0.2)],
				['hullDark', v(R - 0.03, y + band * 0.8)],
				['hullDark', v(R, y + band)]
			);
		} else {
			segments.push(
				['hullRed', v(R + 0.012, y + band * 0.1)],
				['hullRed', v(R + 0.012, y + band * 0.9)],
				['hullRed', v(R, y + band)]
			);
		}
	}
	segments.push(
		['hullPaint', v(R, bodyEnd)],
		// Waist and collar
		['hullDark', v(0.42, bodyEnd + 0.02)],
		['hullDark', v(0.42, bodyEnd + 0.05)],
		['hullDark', v(collarRadius, bodyEnd + 0.06)],
		['hullDark', v(collarRadius, bodyEnd + 0.18)],
		// Converging nozzle, tangent to the collar
		['hullPaint', v(collarRadius, bodyEnd + 0.24), v(exit * 1.05, length - 0.03), v(exit, length)],
		// Thick exit lip, inwards, then a dark seam before the petals
		['hullPaint', v(lip, length)],
		['hullDark', coneOuter],
		// Petal cone, converging strongly to the small core
		['hullDark', v(lip * 0.85, length - 0.08), v(core.radius * 1.2, core.y + 0.04), v(core.radius, core.y)],
		// Core bottom: the exhaust glow
		['exhaust', v(0, core.y)]
	);

	return {
		runs: profileRuns(v(0.3, 0), segments),
		collar: { radius: collarRadius, y: bodyEnd + 0.12 },
		cone: { outer: coneOuter, inner: v(core.radius, core.y) },
		core,
	};
}

/**
 * Groups consecutive segments with the same material into Bézier chains. Each run starts where the previous one ended,
 * so the revolved meshes meet exactly.
 */
function profileRuns(start, segments) {
	const runs = [];
	let from = start;
	for (const [material, ...points] of segments) {
		const end = points[points.length - 1];
		const [c1, c2] = points.length === 3 ? points : [from.clone().lerp(end, 1 / 3), from.clone().lerp(end, 2 / 3)];
		let run = runs[runs.length - 1];
		if (run?.material !== material) {
			run = { material, points: [from] };
			runs.push(run);
		}
		run.points.push(c1, c2, end);
		from = end;
	}
	return runs.map(({ material, points }) => ({ material, profile: bezierChain2(points) }));
}

/**
 * `count` boxes of `[radial, axial, tangential]` size spread around the y axis at `radius` and height `y`, each turned
 * by `rotation` (`{ x, z }`: about its radial axis, about its tangential axis) before being placed, merged into one
 * geometry.
 */
function radialRing(count, radius, y, [radial, axial, tangential], { x = 0, z = 0 } = {}) {
	const local = new THREE.Matrix4()
		.makeTranslation(radius, y, 0)
		.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, 0, z)));
	const geometries = Array.from({ length: count }, (_, i) =>
		new THREE.BoxGeometry(radial, axial, tangential).applyMatrix4(
			new THREE.Matrix4().makeRotationY((i / count) * Math.PI * 2).multiply(local)
		)
	);
	const merged = mergeGeometries(geometries);
	geometries.forEach((geometry) => geometry.dispose());
	return merged;
}
