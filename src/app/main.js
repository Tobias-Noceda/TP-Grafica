import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { createMaterials } from './materials.js';
import { buildHangar, HANGAR } from '../hangar/hangar.js';
import { buildPlatform } from '../hangar/platform.js';
import { buildSpace } from '../scene/space.js';
import { buildFuselage } from '../parts/fuselage.js';
import { createLoadout, PART_KINDS } from './loadout.js';
import { createMenu } from './menu.js';
import { createCameras } from './cameras.js';
import { setupShadows } from './shadows.js';

let container, renderer, scene, cameras, renderPass, composer, bloomPass, space, fuselage, loadout, shadows, menu;
const clock = new THREE.Clock();

// Ship configuration edited by the menu
const config = {
	wing: { variant: 'xwing', params: { ...PART_KINDS.wing.xwing.defaults } },
	weapon: { variant: 'machineGun', hardpoint: 'nose' },
	thruster: { variant: 'rearEngine', hardpoint: 'rear' },
	view: { camera: 0, shadows: 'low' },
};

// Toggle animations: `t` moves towards `target` in `duration` seconds and is applied with easing.
// Gear: 0 = retracted, 1 = deployed (T). Wings: 0 = closed, 1 = open in X (O); parked closed.
const gear = { t: 1, target: 1, duration: 2 };
const wingFold = { t: 0, target: 0, duration: 1.2 };

function setupThreeJs() {
	container = document.getElementById('container3D');

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;
	container.appendChild(renderer.domElement);

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);

	// Generic studio reflections so the metallic surfaces are not black where no light hits them
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
	pmrem.dispose();

	shadows = setupShadows(renderer, scene, config.view.shadows);

	composer = new EffectComposer(renderer);
	// The camera is set once the cameras exist (they need the fuselage)
	renderPass = new RenderPass(scene, null);
	composer.addPass(renderPass);
	bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 1);
	composer.addPass(bloomPass);
	composer.addPass(new OutputPass());
}

function buildScene() {
	const materials = createMaterials(renderer);
	scene.add(buildHangar(materials));
	const platform = buildPlatform(materials);
	scene.add(platform);

	fuselage = buildFuselage(materials);
	platform.userData.mountPoint.add(fuselage);

	// Only the ship casts; the platform deck and the hangar floor receive
	shadows.enableOn(platform);
	shadows.enableOn(scene.getObjectByName('floor'));
	shadows.addContactShadow(platform.userData.mountPoint);
	const shipShadows = () => shadows.enableOn(fuselage, { cast: true });

	// Placeholder for the crane's moving element until the crane exists: on the ceiling, above the platform
	const craneAnchor = new THREE.Object3D();
	craneAnchor.name = 'crane-anchor';
	craneAnchor.position.set(0, HANGAR.height - 2, 0);
	scene.add(craneAnchor);

	cameras = createCameras({ renderer, fuselage, craneAnchor, hint: document.getElementById('walk-hint') });
	renderPass.camera = cameras.active;
	cameras.onChange((index) => {
		renderPass.camera = cameras.active;
		config.view.camera = index;
		menu?.refresh();
	});

	// Parts are mounted instantly until the crane assembles the ship
	loadout = createLoadout(fuselage, materials);
	const equipWings = () => {
		loadout.equipWings(config.wing.variant, config.wing.params);
		shipShadows();
	};
	const equipPart = (kind) => () => {
		try {
			loadout.equip(kind, config[kind].variant, config[kind].hardpoint);
		} catch (error) {
			console.warn(error.message);
		}
		shipShadows();
	};
	const equipWeapon = equipPart('weapon');
	const equipThruster = equipPart('thruster');
	equipWings();
	equipWeapon();
	equipThruster();
	menu = createMenu(config, {
		onWingChange: equipWings,
		onWingToggle: () => toggle(wingFold),
		onWeaponChange: equipWeapon,
		onThrusterChange: equipThruster,
		cameraOptions: Object.fromEntries(cameras.list.map(({ label }, i) => [`${i + 1}. ${label}`, i])),
		onCameraChange: (index) => cameras.set(index),
		onShadowsChange: (level) => shadows.setQuality(level),
	});

	space = buildSpace();
	scene.add(space.group);
}

function onResize() {
	const width = container.offsetWidth;
	const height = container.offsetHeight;

	cameras.resize(width, height);

	renderer.setSize(width, height);
	composer.setSize(width, height);
	bloomPass.resolution.set(width, height);
}

function onKeyDown(event) {
	// Typing in a menu field must not switch cameras or toggle parts
	if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
	if (event.code === 'KeyT') toggle(gear);
	if (event.code === 'KeyO') toggle(wingFold);
	if (event.code === 'KeyC') cameras.next();
	const digit = /^Digit([1-6])$/.exec(event.code);
	if (digit) cameras.set(Number(digit[1]) - 1);
}

function toggle(state) {
	state.target = 1 - state.target;
}

function stepToggle(state, dt, apply) {
	if (state.t === state.target) return;
	const step = dt / state.duration;
	state.t = state.target > state.t ? Math.min(state.t + step, state.target) : Math.max(state.t - step, state.target);
	apply(THREE.MathUtils.smoothstep(state.t, 0, 1));
}

function animate() {
	requestAnimationFrame(animate);
	const dt = clock.getDelta();

	cameras.update(dt);
	space.update(dt);
	// Moving casters re-render the shadow map; idle frames skip the shadow pass
	stepToggle(gear, dt, (t) => {
		fuselage.userData.setGearDeploy(t);
		shadows.markDirty();
	});
	stepToggle(wingFold, dt, (t) => {
		loadout.setWingsOpen(t);
		shadows.markDirty();
	});
	shadows.render();
	composer.render(dt);
}

setupThreeJs();
buildScene();
window.addEventListener('resize', onResize);
window.addEventListener('keydown', onKeyDown);
onResize();
animate();
