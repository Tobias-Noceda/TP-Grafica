/**
 * Replaces the UVs of a geometry with world-scale box-projected UVs.
 * Each vertex is projected on the plane perpendicular to the dominant axis of its normal,
 * so a tiling texture keeps the same physical size on every face regardless of the mesh dimensions.
 *
 * @param {THREE.BufferGeometry} geometry geometry with `position` and `normal` attributes
 * @param {number} tileSize size in metres covered by one repetition of the texture
 * @returns {THREE.BufferGeometry} the same geometry, for chaining
 */
export function setBoxProjectedUVs(geometry, tileSize) {
	const position = geometry.getAttribute('position');
	const normal = geometry.getAttribute('normal');
	const uv = geometry.getAttribute('uv');

	for (let i = 0; i < position.count; i++) {
		const x = position.getX(i);
		const y = position.getY(i);
		const z = position.getZ(i);
		const nx = Math.abs(normal.getX(i));
		const ny = Math.abs(normal.getY(i));
		const nz = Math.abs(normal.getZ(i));

		let u, v;
		if (nx >= ny && nx >= nz) {
			u = z;
			v = y;
		} else if (ny >= nz) {
			u = x;
			v = z;
		} else {
			u = x;
			v = y;
		}
		uv.setXY(i, u / tileSize, v / tileSize);
	}
	uv.needsUpdate = true;
	return geometry;
}
