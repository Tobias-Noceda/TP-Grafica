import * as THREE from 'three';

import { sampleShape } from './curves.js';
import { levelMatrices, levelParams } from './frames.js';

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

/**
 * Variable-shape sweep: `shapeAt(v)` returns the closed 2D section (a CCW `CurvePath`) for path parameter v, and each
 * level places it with its matrix M = [N B T P]: P_ij = M_j · (x_i, y_i, 0, 1). The section x axis maps to N, y to B.
 *
 * - Every section must have the same sub-curves count, so all levels have the same vertex count (checked).
 * - `levels` path segments cover [vStart, vEnd], so one surface can be split into consecutive meshes (e.g. to change
 *   material) whose boundary sections match exactly.
 * - Normals: (M · section tangent) × ∂P/∂v, with ∂P/∂v by central differences across levels, oriented like the
 *   rotated section normal. Unlike rotating the 2D normal alone, this stays correct when the section changes along
 *   the path, and knots (sampled twice by `sampleShape`) keep hard edges.
 * - UVs: u = section arc length (seam duplicated), v = path parameter (arc length).
 * - `caps.start` / `caps.end`: flat caps triangulated with `ShapeUtils.triangulateShape`, own vertices, normals ∓T.
 */
export function buildVariableSweepGeometry({
	shapeAt,
	path,
	segmentsPerCurve = 8,
	levels = 32,
	vStart = 0,
	vEnd = 1,
	caps = { start: true, end: true },
	up,
	frameMethod = 'up',
}) {
	const vs = levelParams(levels).map((t) => THREE.MathUtils.lerp(vStart, vEnd, t));
	const matrices = levelMatrices(path, vs, { up, method: frameMethod });
	const sections = vs.map((v) => sampleShape(shapeAt(v), segmentsPerCurve));
	const count = sections[0].points.length;
	if (sections.some((section) => section.points.length !== count)) {
		throw new Error('buildVariableSweepGeometry: every section must have the same vertex count');
	}

	const rings = sections.map(({ points }, j) =>
		points.map((p) => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(matrices[j]))
	);
	const last = vs.length - 1;

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	const rotation = new THREE.Matrix3();
	const du = new THREE.Vector3();
	const dv = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const reference = new THREE.Vector3();

	for (let j = 0; j <= last; j++) {
		rotation.setFromMatrix4(matrices[j]);
		const { normals: sectionNormals, u } = sections[j];
		for (let i = 0; i < count; i++) {
			const n2 = sectionNormals[i];
			// Section tangent from its normal: n = (ty, -tx) → t = (-ny, nx)
			du.set(-n2.y, n2.x, 0).applyMatrix3(rotation);
			dv.subVectors(rings[Math.min(j + 1, last)][i], rings[Math.max(j - 1, 0)][i]);
			reference.set(n2.x, n2.y, 0).applyMatrix3(rotation);
			normal.crossVectors(du, dv);
			if (normal.lengthSq() < 1e-12) normal.copy(reference);
			normal.normalize();
			if (normal.dot(reference) < 0) normal.negate();

			const p = rings[j][i];
			positions.push(p.x, p.y, p.z);
			normals.push(normal.x, normal.y, normal.z);
			uvs.push(u[i], vs[j]);
		}
	}

	// Quad between levels j and j+1: a → b along the section, b → c along the path; CCW sections face outwards
	for (let j = 0; j < last; j++) {
		for (let i = 0; i < count - 1; i++) {
			const a = j * count + i;
			const b = a + 1;
			const c = (j + 1) * count + i + 1;
			const d = (j + 1) * count + i;
			indices.push(a, b, c, a, c, d);
		}
	}

	if (caps.start) addCap(0, -1);
	if (caps.end) addCap(last, 1);

	function addCap(j, side) {
		// Drop the duplicated knot samples (and the closing point) so the contour has no repeated vertices
		const contour = [];
		const indexOf = [];
		sections[j].points.forEach((point, i) => {
			const previous = contour[contour.length - 1];
			if (previous && previous.distanceToSquared(point) < 1e-12) return;
			contour.push(point);
			indexOf.push(i);
		});
		if (contour.length > 2 && contour[0].distanceToSquared(contour[contour.length - 1]) < 1e-12) {
			contour.pop();
			indexOf.pop();
		}

		const faces = THREE.ShapeUtils.triangulateShape(contour, []);
		const capNormal = new THREE.Vector3().setFromMatrixColumn(matrices[j], 2).normalize().multiplyScalar(side);
		const box = new THREE.Box2().setFromPoints(contour);
		const size = box.getSize(new THREE.Vector2());
		const base = positions.length / 3;

		contour.forEach((point, k) => {
			const p = rings[j][indexOf[k]];
			positions.push(p.x, p.y, p.z);
			normals.push(capNormal.x, capNormal.y, capNormal.z);
			uvs.push((point.x - box.min.x) / (size.x || 1), (point.y - box.min.y) / (size.y || 1));
		});

		// The end cap (+T) must be CCW in section coordinates, the start cap (-T) CW
		for (const [a, b, c] of faces) {
			const ccw = THREE.ShapeUtils.area([contour[a], contour[b], contour[c]]) > 0;
			if (ccw === side > 0) indices.push(base + a, base + b, base + c);
			else indices.push(base + a, base + c, base + b);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	return geometry;
}
