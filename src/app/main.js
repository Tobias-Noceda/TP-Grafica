import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { createMaterials } from './materials.js';
import { buildHangar, HANGAR } from './hangar.js';
import { buildSpace } from './space.js';

let container, renderer, scene, camera, controls, composer, bloomPass, space;
const clock = new THREE.Clock();

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
	onResize();
}

function buildScene() {
	const materials = createMaterials(renderer);
	scene.add(buildHangar(materials));

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

function animate() {
	requestAnimationFrame(animate);
	const dt = clock.getDelta();

	controls.update();
	space.update(dt);
	composer.render(dt);
}

setupThreeJs();
buildScene();
animate();
