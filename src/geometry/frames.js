import * as THREE from 'three';

/**
 * Level parameters v ∈ [0, 1]: either `levels + 1` uniform values or an explicit sorted array.
 */
export function levelParams(levels) {
	if (Array.isArray(levels)) return levels;
	return Array.from({ length: levels + 1 }, (_, j) => j / levels);
}

/**
 * One Matrix4 per level with columns [N, B, T, P] (normal, binormal, tangent, position on the path). `vs` are
 * arc-length parameters (`getPointAt` / `getTangentAt`).
 *
 * - `method: 'up'`: N = up × T at every level. No twist, but breaks if the path becomes parallel to `up`.
 * - `method: 'parallel'`: the first frame uses `up`, then N is carried along by the minimal rotation between
 *   consecutive tangents (parallel transport), which avoids the Frenet flips on straight parts and inflections.
 */
export function levelMatrices(path, vs, { up = new THREE.Vector3(0, 1, 0), method = 'parallel' } = {}) {
	const normal = new THREE.Vector3();
	const binormal = new THREE.Vector3();
	const rotation = new THREE.Quaternion();
	let previousTangent = null;

	return vs.map((v) => {
		const position = path.getPointAt(v);
		const tangent = path.getTangentAt(v).normalize();

		if (method === 'up' || !previousTangent) {
			normal.crossVectors(up, tangent).normalize();
		} else {
			normal.applyQuaternion(rotation.setFromUnitVectors(previousTangent, tangent));
			normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
		}
		binormal.crossVectors(tangent, normal);
		previousTangent = tangent;

		return new THREE.Matrix4().makeBasis(normal, binormal, tangent).setPosition(position);
	});
}
