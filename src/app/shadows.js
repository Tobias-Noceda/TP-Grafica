import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

import { HANGAR } from '../hangar/hangar.js';

/** Per quality level: spot shadow map side and contact shadow texture side (`off` disables both). */
export const SHADOW_QUALITY = {
	off: { spot: 0, contact: 0 },
	low: { spot: 1024, contact: 256 },
	high: { spot: 2048, contact: 512 },
};

// Only objects on this layer are drawn into the contact shadow (the ship), so the platform does not shade itself
const CONTACT_LAYER = 1;
const CONTACT = { size: 10, height: 4, darkness: 1.6, blur: 2.5, opacity: 0.85 };

/**
 * Minimal, cheap shadows for the ship, re-rendered **only when something moves** (`markDirty()`), never per frame:
 *
 * - **Spot shadow**: one ceiling `SpotLight` above the platform is the only shadow-casting light (a point light shadow
 *   needs 6 renders, a spot one needs 1). It gives the ship's self-shadowing (wings on the hull, gear bays). The deck
 *   and walls are fully metallic, so direct-light shadows hardly show on them.
 * - **Contact shadow** (`addContactShadow`): the ship's depth seen from below, blurred, on a transparent plane over
 *   the deck. It darkens the deck under the ship whatever its material (the soft "grounding" shadow).
 *
 * `shadowMap.autoUpdate = false`, so idle frames run no shadow pass (the contact render, when dirty, also refreshes the
 * spot shadow map, which does not depend on the camera). Call `markDirty()` when a caster moves (gear,
 * wings, equipped parts, later the crane) and `render()` once per frame before the scene render.
 */
export function setupShadows(renderer, scene, quality = 'low') {
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.shadowMap.autoUpdate = false;

	// Above the platform centre, just under the ceiling beams, aimed straight down at the deck
	const light = new THREE.SpotLight(0xffe2c0, 400, 0, 0.5, 0.6, 2);
	light.name = 'shadow-spot';
	light.position.set(0, HANGAR.height - 1, 0);
	light.target.position.set(0, 0, 0);
	scene.add(light, light.target);

	// Tight depth range around the ship (deck at ~14.7 m) keeps the depth precision high
	light.shadow.camera.near = 6;
	light.shadow.camera.far = 18;
	light.shadow.bias = -0.0005;
	light.shadow.normalBias = 0.03;

	let contact = null;
	let contactDirty = true;
	let level = quality;

	const markDirty = () => {
		renderer.shadowMap.needsUpdate = true;
		contactDirty = true;
	};

	/**
	 * Flags every mesh under `object`. Casters also join the contact shadow layer. Transparent meshes (canopy glass)
	 * never cast, so light passes through them.
	 */
	const enableOn = (object, { cast = false, receive = true } = {}) => {
		object.traverse((child) => {
			if (!child.isMesh) return;
			const materials = Array.isArray(child.material) ? child.material : [child.material];
			child.castShadow = cast && !materials.some((material) => material.transparent);
			child.receiveShadow = receive;
			if (child.castShadow) child.layers.enable(CONTACT_LAYER);
		});
		markDirty();
	};

	const setQuality = (next) => {
		level = SHADOW_QUALITY[next] ? next : 'off';
		const { spot, contact: contactSize } = SHADOW_QUALITY[level];
		light.castShadow = spot > 0;
		if (spot > 0 && spot !== light.shadow.mapSize.x) {
			light.shadow.mapSize.set(spot, spot);
			// The render target is recreated at the new size on the next shadow pass
			light.shadow.map?.dispose();
			light.shadow.map = null;
		}
		contact?.setResolution(contactSize);
		markDirty();
	};

	/** Adds the contact shadow plane to `parent`, an `Object3D` on the deck surface under the ship. */
	const addContactShadow = (parent) => {
		contact = createContactShadow(renderer, scene);
		parent.add(contact.group);
		contact.setResolution(SHADOW_QUALITY[level].contact);
		markDirty();
	};

	const render = () => {
		if (!contact || !contactDirty) return;
		contactDirty = false;
		if (contact.group.visible) contact.render();
	};

	setQuality(quality);
	return { light, enableOn, markDirty, setQuality, addContactShadow, render };
}

/**
 * Contact shadow after the three.js `webgl_shadow_contact` example: an orthographic camera on the deck looks up and
 * draws the ship (layer `CONTACT_LAYER`) as black with alpha growing towards the deck; two blur passes soften it; the
 * result is the texture of a transparent plane lying on the deck.
 */
function createContactShadow(renderer, scene) {
	const { size, height, darkness, blur, opacity } = CONTACT;
	const group = new THREE.Group();
	group.name = 'contact-shadow';
	// Just above the deck so it does not z-fight with it
	group.position.y = 0.01;

	let target = null;
	let targetBlur = null;

	const geometry = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2);
	const plane = new THREE.Mesh(
		geometry,
		new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, toneMapped: false })
	);
	// The camera looks up, so the image is mirrored in z: flip it back. Drawn after the opaque deck.
	plane.scale.y = -1;
	plane.renderOrder = 1;
	group.add(plane);

	const blurPlane = new THREE.Mesh(geometry);
	blurPlane.visible = false;
	// On the camera's layer so the blur passes draw it
	blurPlane.layers.set(CONTACT_LAYER);
	group.add(blurPlane);

	const camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
	camera.rotation.x = Math.PI / 2;
	camera.layers.set(CONTACT_LAYER);
	group.add(camera);

	// Black, with alpha = closeness to the deck: low parts (gear, belly) shade more than the wings
	const depthMaterial = new THREE.MeshDepthMaterial();
	depthMaterial.onBeforeCompile = (shader) => {
		shader.uniforms.darkness = { value: darkness };
		shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
			'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
			'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
		)}`;
	};
	depthMaterial.depthTest = false;
	depthMaterial.depthWrite = false;

	const horizontalBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
	const verticalBlur = new THREE.ShaderMaterial(VerticalBlurShader);
	horizontalBlur.depthTest = verticalBlur.depthTest = false;

	const blurPass = (amount, resolution) => {
		blurPlane.visible = true;
		blurPlane.material = horizontalBlur;
		horizontalBlur.uniforms.tDiffuse.value = target.texture;
		horizontalBlur.uniforms.h.value = amount / resolution;
		renderer.setRenderTarget(targetBlur);
		renderer.render(blurPlane, camera);

		blurPlane.material = verticalBlur;
		verticalBlur.uniforms.tDiffuse.value = targetBlur.texture;
		verticalBlur.uniforms.v.value = amount / resolution;
		renderer.setRenderTarget(target);
		renderer.render(blurPlane, camera);
		blurPlane.visible = false;
	};

	return {
		group,
		setResolution(resolution) {
			group.visible = resolution > 0;
			if (!resolution || target?.width === resolution) return;
			target?.dispose();
			targetBlur?.dispose();
			target = new THREE.WebGLRenderTarget(resolution, resolution);
			targetBlur = new THREE.WebGLRenderTarget(resolution, resolution);
			target.texture.generateMipmaps = targetBlur.texture.generateMipmaps = false;
			plane.material.map = target.texture;
			plane.material.needsUpdate = true;
		},
		render() {
			const background = scene.background;
			const clearAlpha = renderer.getClearAlpha();
			scene.background = null;
			scene.overrideMaterial = depthMaterial;
			renderer.setClearAlpha(0);

			renderer.setRenderTarget(target);
			renderer.clear();
			renderer.render(scene, camera);
			scene.overrideMaterial = null;

			const resolution = target.width;
			blurPass(blur, resolution);
			// A second, finer pass removes the blur's banding
			blurPass(blur * 0.4, resolution);

			renderer.setRenderTarget(null);
			renderer.setClearAlpha(clearAlpha);
			scene.background = background;
		},
	};
}
