import * as THREE from 'three';

/**
 * Piecewise cubic Bézier through 3k+1 control points. Consecutive segments share endpoints (C0); align p2 of
 * segment i, the shared point and p1 of segment i+1 on a line for C1, or leave them unaligned for a sharp knot.
 */
export function bezierChain2(points) {
	if ((points.length - 1) % 3 !== 0) throw new Error('bezierChain2 needs 3k+1 points');
	const path = new THREE.CurvePath();
	for (let i = 0; i + 3 < points.length; i += 3) {
		path.add(new THREE.CubicBezierCurve(points[i], points[i + 1], points[i + 2], points[i + 3]));
	}
	return path;
}

/**
 * Samples every sub-curve of a 2D `CurvePath` separately with `segmentsPerCurve` segments. The shared point between
 * two sub-curves is emitted twice, once with each curve's normal, so knots stay sharp (flat vs smooth shading).
 *
 * The normal of tangent (dx, dy) is (dy, -dx): the right-hand side of the direction of travel. For a revolution
 * profile drawn with increasing y, that is the side facing away from the axis.
 *
 * Returns `points`, unit `normals` and `u` (arc-length fraction along the whole path), all with the same length.
 */
export function sampleShape(curvePath, segmentsPerCurve) {
	const points = [];
	const normals = [];
	const lengths = [];
	let length = 0;

	for (const curve of curvePath.curves) {
		for (let i = 0; i <= segmentsPerCurve; i++) {
			const t = i / segmentsPerCurve;
			const point = curve.getPoint(t);
			const tangent = curve.getTangent(t);

			if (points.length > 0) length += point.distanceTo(points[points.length - 1]);
			points.push(point);
			normals.push(new THREE.Vector2(tangent.y, -tangent.x).normalize());
			lengths.push(length);
		}
	}

	return { points, normals, u: lengths.map((l) => l / (length || 1)) };
}

/**
 * Closed CCW rounded rectangle centred on the origin, as 9 cubic Béziers: the bottom side split in two (so the seam
 * sits in the middle of a flat side), the other 3 sides, and 4 quarter-round corners (circle approximation,
 * k ≈ 0.5523). Always the same sub-curve count, so it can morph inside a variable-shape sweep. Sides and corners join
 * C1. `radius` must stay above 0 and below min(halfWidth, halfHeight): a zero-length piece has no tangent (no normal).
 */
export function roundedRectangle(halfWidth, halfHeight, radius) {
	const w = halfWidth;
	const h = halfHeight;
	const r = radius;
	const k = 0.5523 * r;
	const v = (x, y) => new THREE.Vector2(x, y);
	const line = (a, b) => [a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3), b];

	const start = v(0, -h);
	return bezierChain2([
		start,
		...line(start, v(w - r, -h)),
		v(w - r + k, -h),
		v(w, -h + r - k),
		v(w, -h + r),
		...line(v(w, -h + r), v(w, h - r)),
		v(w, h - r + k),
		v(w - r + k, h),
		v(w - r, h),
		...line(v(w - r, h), v(-w + r, h)),
		v(-w + r - k, h),
		v(-w, h - r + k),
		v(-w, h - r),
		...line(v(-w, h - r), v(-w, -h + r)),
		v(-w, -h + r - k),
		v(-w + r - k, -h),
		v(-w + r, -h),
		...line(v(-w + r, -h), start),
	]);
}
