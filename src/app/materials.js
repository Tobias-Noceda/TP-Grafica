import * as THREE from 'three';

// PBR texture sets from Poly Haven (CC0). Real-world size of one texture repetition, in metres.
const TEXTURE_SETS = {
	floorTiles: { path: 'textures/concrete_tiles_02/concrete_tiles_02', tileSize: 5.5 },
	metalPlate: { path: 'textures/metal_plate_02/metal_plate_02', tileSize: 2 },
};

/**
 * Loads a Poly Haven texture set: diffuse, OpenGL normal map and ARM (AO / roughness / metalness packed in RGB).
 */
function loadTextureSet(loader, { path }, maxAnisotropy) {
	const load = (suffix, colorSpace) => {
		const texture = loader.load(`${path}_${suffix}_1k.jpg`);
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
		texture.anisotropy = maxAnisotropy;
		texture.colorSpace = colorSpace;
		return texture;
	};

	const arm = load('arm', THREE.NoColorSpace);
	return {
		map: load('diff', THREE.SRGBColorSpace),
		normalMap: load('nor_gl', THREE.NoColorSpace),
		aoMap: arm,
		roughnessMap: arm,
		metalnessMap: arm,
	};
}

/**
 * Builds the shared material library used by the hangar.
 * Textured materials expect world-scale UVs (see `setBoxProjectedUVs`), with `tileSize` metres per repetition.
 */
export function createMaterials(renderer) {
	const loader = new THREE.TextureLoader();
	const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
	const floorTiles = loadTextureSet(loader, TEXTURE_SETS.floorTiles, maxAnisotropy);
	const metalPlate = loadTextureSet(loader, TEXTURE_SETS.metalPlate, maxAnisotropy);

	return {
		tileSizes: {
			floor: TEXTURE_SETS.floorTiles.tileSize,
			metal: TEXTURE_SETS.metalPlate.tileSize,
		},

		// Polished floor: low roughness so the lamps leave long reflections like in the reference
		floor: new THREE.MeshStandardMaterial({
			...floorTiles,
			color: 0x6f747b,
			roughness: 0.3,
			metalness: 0.2,
			envMapIntensity: 0.6,
		}),

		wall: new THREE.MeshStandardMaterial({
			...metalPlate,
			color: 0x8c99a8,
			roughness: 1,
			metalness: 1,
			envMapIntensity: 0.9,
		}),

		darkMetal: new THREE.MeshStandardMaterial({
			...metalPlate,
			color: 0x4f5965,
			roughness: 0.9,
			metalness: 1,
			envMapIntensity: 0.7,
		}),

		trim: new THREE.MeshStandardMaterial({
			color: 0xd99a1e,
			roughness: 0.45,
			metalness: 0.4,
		}),

		rubber: new THREE.MeshStandardMaterial({
			color: 0x141414,
			roughness: 0.65,
			metalness: 0,
		}),

		// Ship: untextured paint and metals
		// Matte paint: the hull faces are flat, so a glossy finish reflects the lamps and environment on a whole face
		hullPaint: new THREE.MeshStandardMaterial({
			color: 0xd8d6cf,
			roughness: 0.75,
			metalness: 0.05,
			envMapIntensity: 0.4,
		}),

		hullRed: new THREE.MeshStandardMaterial({
			color: 0xa8231c,
			roughness: 0.75,
			metalness: 0.05,
			envMapIntensity: 0.4,
		}),

		hullDark: new THREE.MeshStandardMaterial({
			color: 0x2b2f35,
			roughness: 0.6,
			metalness: 0.7,
		}),

		chrome: new THREE.MeshStandardMaterial({
			color: 0xc8ccd2,
			roughness: 0.2,
			metalness: 1,
		}),

		flightSuit: new THREE.MeshStandardMaterial({
			color: 0xd9622b,
			roughness: 0.85,
			metalness: 0,
		}),

		glass: new THREE.MeshStandardMaterial({
			color: 0x9fc4e0,
			// The studio environment map has very bright panels; keep its reflection faint on the flat canopy faces
			roughness: 0.1,
			metalness: 0,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
			side: THREE.DoubleSide,
			envMapIntensity: 0.35,
		}),

		lampWarm: new THREE.MeshStandardMaterial({
			color: 0x000000,
			emissive: 0xffc68a,
			emissiveIntensity: 6,
		}),

		lampCool: new THREE.MeshStandardMaterial({
			color: 0x000000,
			emissive: 0x6fe8ff,
			emissiveIntensity: 4,
		}),
	};
}
