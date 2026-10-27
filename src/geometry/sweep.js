import * as THREE from 'three';

import { sampleShape } from './curves.js';

/**
 * Surface of revolution: a 2D profile in the XY plane (x = radius, y = height) revolved around the Y axis. It is the
 * sweep whose path is a circle, so each level is the profile rotated by φ.
 *
 * - Normals are the 2D profile normals rotated with the level, not estimated from neighbours, so Bézier knots in the
 *   profile keep hard edges (each knot is sampled twice by `sampleShape`).
 * - The seam column (φ = 0 and φ = 2π) is duplicated so UVs do not smear: u = φ fraction, v = profile arc length.
 * - Draw the profile with increasing y on the outer surface; segments drawn downwards face the axis (e.g. a bore).
 */
export function buildRevolutionGeometry({ profile, segmentsPerCurve = 12, radialSegments = 32 }) {
	const { points, normals, u } = sampleShape(profile, segmentsPerCurve);
	const ring = radialSegments + 1;

	const positions = [];
	const normalValues = [];
	const uvs = [];
	const indices = [];

	points.forEach((point, k) => {
		const normal = normals[k];
		for (let j = 0; j <= radialSegments; j++) {
			const phi = (j / radialSegments) * Math.PI * 2;
			const sin = Math.sin(phi);
			const cos = Math.cos(phi);
			positions.push(point.x * sin, point.y, point.x * cos);
			normalValues.push(normal.x * sin, normal.y, normal.x * cos);
			uvs.push(j / radialSegments, u[k]);
		}
	});

	// Quad between profile samples k and k+1: a → b follows φ, b → c follows the profile, so (b - a) × (c - b) points
	// to the side of the profile normal (CCW seen from that side)
	for (let k = 0; k < points.length - 1; k++) {
		for (let j = 0; j < radialSegments; j++) {
			const a = k * ring + j;
			const b = a + 1;
			const c = (k + 1) * ring + j + 1;
			const d = (k + 1) * ring + j;
			indices.push(a, b, c, a, c, d);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalValues, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	return geometry;
}
