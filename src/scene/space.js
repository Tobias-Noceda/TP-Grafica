import * as THREE from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

// Seen through the hangar opening (+z), low and to the left like in the reference art.
// Looking towards +z, screen-left is +x.
const PLANET = {
	radius: 700,
	position: new THREE.Vector3(520, -380, 950),
	rotationSpeed: 0.004, // rad/s
};

const STARS_RADIUS = 3000;

// Direction from the planet towards its sun, in world space
const SUN_DIRECTION = new THREE.Vector3(-0.7, 0.45, -0.55).normalize();

/**
 * Builds everything outside the hangar: starfield, gas giant and its atmosphere.
 * Returns the group plus an `update(dt)` function for the slow planet rotation.
 */
export function buildSpace() {
	const space = new THREE.Group();
	space.name = 'space';

	space.add(buildStarfield(6000, 1.2, 0.7));
	space.add(buildStarfield(600, 2.4, 1.0));

	const planet = buildPlanet();
	space.add(planet);

	return {
		group: space,
		update(dt) {
			planet.userData.surface.rotation.y += PLANET.rotationSpeed * dt;
		},
	};
}

function buildStarfield(count, size, brightness) {
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const direction = new THREE.Vector3();
	const color = new THREE.Color();

	for (let i = 0; i < count; i++) {
		direction.randomDirection().multiplyScalar(STARS_RADIUS);
		direction.toArray(positions, i * 3);

		// Mostly white stars with a few bluish and warm ones
		const hue = Math.random() < 0.5 ? 0.6 : 0.1;
		color.setHSL(hue, Math.random() * 0.35, brightness * (0.45 + Math.random() * 0.55));
		color.toArray(colors, i * 3);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

	const material = new THREE.PointsMaterial({
		size,
		sizeAttenuation: false,
		vertexColors: true,
		depthWrite: false,
	});

	const stars = new THREE.Points(geometry, material);
	stars.name = 'stars';
	return stars;
}

function buildPlanet() {
	const planet = new THREE.Group();
	planet.name = 'planet';
	planet.position.copy(PLANET.position);
	// Tilt the rotation axis so the bands cross the opening diagonally
	planet.rotation.set(0.35, 0, 0.45);

	const surface = new THREE.Mesh(
		new THREE.SphereGeometry(PLANET.radius, 128, 64),
		new THREE.ShaderMaterial({
			uniforms: {
				map: { value: generateGasGiantTexture(2048, 1024) },
				sunDirection: { value: SUN_DIRECTION },
				rimColor: { value: new THREE.Color(0x58d6ff) },
			},
			vertexShader: SURFACE_VERTEX,
			fragmentShader: SURFACE_FRAGMENT,
		})
	);
	planet.add(surface);

	const atmosphere = new THREE.Mesh(
		new THREE.SphereGeometry(PLANET.radius * 1.035, 128, 64),
		new THREE.ShaderMaterial({
			uniforms: {
				sunDirection: { value: SUN_DIRECTION },
				glowColor: { value: new THREE.Color(0x4fd0ff) },
			},
			vertexShader: ATMOSPHERE_VERTEX,
			fragmentShader: ATMOSPHERE_FRAGMENT,
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending,
			transparent: true,
			depthWrite: false,
		})
	);
	planet.add(atmosphere);

	planet.userData.surface = surface;
	return planet;
}

/**
 * Equirectangular gas giant texture: latitude bands distorted by domain-warped 3D Perlin noise,
 * mapped to a purple / magenta / gold palette. Noise is sampled on the unit sphere so the seam is continuous.
 */
function generateGasGiantTexture(width, height) {
	const noise = new ImprovedNoise();
	const fbm = (x, y, z, octaves) => {
		let sum = 0;
		let amplitude = 0.5;
		let frequency = 1;
		for (let o = 0; o < octaves; o++) {
			sum += amplitude * noise.noise(x * frequency, y * frequency, z * frequency);
			frequency *= 2;
			amplitude *= 0.5;
		}
		return sum;
	};

	const palette = [
		[0.0, new THREE.Color(0x0e0620)],
		[0.35, new THREE.Color(0x3a1a63)],
		[0.6, new THREE.Color(0x7a3a8c)],
		[0.78, new THREE.Color(0xb25a78)],
		[0.9, new THREE.Color(0xe0964e)],
		[1.0, new THREE.Color(0xf4d9a4)],
	];
	const sample = new THREE.Color();
	const ramp = (t) => {
		for (let i = 1; i < palette.length; i++) {
			const [t1, c1] = palette[i];
			if (t <= t1) {
				const [t0, c0] = palette[i - 1];
				return sample.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
			}
		}
		return sample.copy(palette[palette.length - 1][1]);
	};

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	const image = context.createImageData(width, height);

	for (let py = 0; py < height; py++) {
		const theta = ((py + 0.5) / height) * Math.PI;
		const y = Math.cos(theta);
		const ring = Math.sin(theta);

		for (let px = 0; px < width; px++) {
			const phi = ((px + 0.5) / width) * Math.PI * 2;
			const x = ring * Math.cos(phi);
			const z = ring * Math.sin(phi);

			const warp = fbm(x * 1.8 + 3.1, y * 1.8, z * 1.8, 3);
			const turbulence = fbm(x * 3.5, y * 9 + warp * 2.5, z * 3.5, 4);
			const band = y * 6 + warp * 2.2 + turbulence * 1.4;
			const detail = fbm(x * 12, y * 24, z * 12, 2) * 0.12;
			const t = THREE.MathUtils.clamp(0.5 + 0.5 * Math.sin(band * 2.4) + detail, 0, 1);

			const color = ramp(t);
			const offset = (py * width + px) * 4;
			image.data[offset] = color.r * 255;
			image.data[offset + 1] = color.g * 255;
			image.data[offset + 2] = color.b * 255;
			image.data[offset + 3] = 255;
		}
	}
	context.putImageData(image, 0, 0);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

const SURFACE_VERTEX = /* glsl */ `
	varying vec2 vUv;
	varying vec3 vWorldNormal;
	varying vec3 vViewDirection;

	void main() {
		vUv = uv;
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vWorldNormal = normalize(mat3(modelMatrix) * normal);
		vViewDirection = normalize(cameraPosition - worldPosition.xyz);
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

const SURFACE_FRAGMENT = /* glsl */ `
	uniform sampler2D map;
	uniform vec3 sunDirection;
	uniform vec3 rimColor;

	varying vec2 vUv;
	varying vec3 vWorldNormal;
	varying vec3 vViewDirection;

	void main() {
		vec3 normal = normalize(vWorldNormal);
		vec3 albedo = texture2D(map, vUv).rgb;

		float sunAngle = dot(normal, sunDirection);
		float daylight = smoothstep(-0.15, 0.5, sunAngle);
		float fresnel = pow(1.0 - max(dot(normal, normalize(vViewDirection)), 0.0), 6.0);

		vec3 color = albedo * (0.02 + 0.85 * daylight);
		color += rimColor * fresnel * daylight * 0.8;

		gl_FragColor = vec4(color, 1.0);

		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	}
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
	varying vec3 vWorldNormal;
	varying vec3 vViewDirection;

	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vWorldNormal = normalize(mat3(modelMatrix) * normal);
		vViewDirection = normalize(cameraPosition - worldPosition.xyz);
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
	uniform vec3 sunDirection;
	uniform vec3 glowColor;

	varying vec3 vWorldNormal;
	varying vec3 vViewDirection;

	void main() {
		// Back faces of a slightly larger shell. limb goes from 0 at the shell silhouette to ~0.26 where the view ray
		// grazes the planet surface (sqrt(1 - (1 / 1.035)^2)), so the glow is brightest at the planet and fades outwards
		vec3 normal = normalize(vWorldNormal);
		float limb = dot(-normal, normalize(vViewDirection));
		float halo = pow(clamp(limb / 0.26, 0.0, 1.0), 3.0);
		float daylight = smoothstep(-0.3, 0.6, dot(normal, sunDirection));

		gl_FragColor = vec4(glowColor * halo * (0.15 + 1.8 * daylight), 1.0);

		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	}
`;
