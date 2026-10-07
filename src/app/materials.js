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
