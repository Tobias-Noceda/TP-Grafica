import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
import { createLoadout } from './loadout.js';
import { createMenu } from './menu.js';

let container, renderer, scene, camera, controls, composer, bloomPass, space, fuselage;
const clock = new THREE.Clock();

// Ship configuration edited by the menu
const config = {
	weapon: { variant: 'machineGun', hardpoint: 'nose' },
};

// Landing gear animation: `t` moves towards `target` (0 = retracted, 1 = deployed) in `duration` seconds
const gear = { t: 1, target: 1, duration: 2 };

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

	// Camera 1 (orbital general): from the back of the hangar looking out through the opening
	camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
	camera.position.set(0, 7, -HANGAR.depth / 2 + 4);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 5, 4);
	controls.enableDamping = true;
	controls.maxDistance = 40;
	controls.maxPolarAngle = Math.PI * 0.55;
	controls.update();

	composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.9);
	composer.addPass(bloomPass);
	composer.addPass(new OutputPass());

	window.addEventListener('resize', onResize);
	window.addEventListener('keydown', onKeyDown);
	onResize();
}

function buildScene() {
	const materials = createMaterials(renderer);
	scene.add(buildHangar(materials));
	const platform = buildPlatform(materials);
	scene.add(platform);

	fuselage = buildFuselage(materials);
	platform.userData.mountPoint.add(fuselage);

	// Parts are mounted instantly until the crane assembles the ship
	const loadout = createLoadout(fuselage, materials);
	const equipWeapon = () => loadout.equip('weapon', config.weapon.variant, config.weapon.hardpoint);
	equipWeapon();
	createMenu(config, { onWeaponChange: equipWeapon });

	space = buildSpace();
	scene.add(space.group);
}

function onResize() {
	const width = container.offsetWidth;
	const height = container.offsetHeight;

	camera.aspect = width / height;
	camera.updateProjectionMatrix();

	renderer.setSize(width, height);
	composer.setSize(width, height);
	bloomPass.resolution.set(width, height);
}

function onKeyDown(event) {
	if (event.code === 'KeyT') gear.target = 1 - gear.target;
}

function updateGear(dt) {
	if (gear.t === gear.target) return;
	const step = dt / gear.duration;
	gear.t = gear.target > gear.t ? Math.min(gear.t + step, gear.target) : Math.max(gear.t - step, gear.target);
	fuselage.userData.setGearDeploy(THREE.MathUtils.smoothstep(gear.t, 0, 1));
}

function animate() {
	requestAnimationFrame(animate);
	const dt = clock.getDelta();

	controls.update();
	space.update(dt);
	updateGear(dt);
	composer.render(dt);
}

setupThreeJs();
buildScene();
animate();
