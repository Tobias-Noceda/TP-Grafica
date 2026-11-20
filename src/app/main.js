import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { createMaterials } from './materials.js';
import { buildHangar } from '../hangar/hangar.js';
import { buildPlatform } from '../hangar/platform.js';
import { buildSpace } from '../scene/space.js';
import { buildFuselage } from '../parts/fuselage.js';
import { createLoadout, PART_KINDS } from './loadout.js';
import { createFloorLayout } from './layout.js';
import { createMenu } from './menu.js';
import { createCameras } from './cameras.js';
import { setupShadows } from './shadows.js';
import { buildCrane } from './crane.js';

let container, renderer, scene, cameras, renderPass, composer, bloomPass, space, fuselage, loadout, shadows, menu;
let crane, layout;
const clock = new THREE.Clock();

// Ship configuration edited by the menu
const config = {
	wing: { variant: 'xwing', params: { ...PART_KINDS.wing.xwing.defaults } },
	weapon: { variant: 'machineGun', hardpoint: 'nose' },
	thruster: { variant: 'rearEngine', hardpoint: 'rear' },
	view: { camera: 0, shadows: 'low' },
	// Where the pieces are: mounted on the ship or spread on the hangar floor (preview for the crane assembly)
	assembly: { layout: 'ship' },
};

// Toggle animations: `t` moves towards `target` in `duration` seconds and is applied with easing.
// Gear: 0 = retracted, 1 = deployed (T). Wings: 0 = closed, 1 = open in X (O); parked closed.
const gear = { t: 1, target: 1, duration: 2 };
const wingFold = { t: 0, target: 0, duration: 1.2 };

// Arrow keys drive the crane in the horizontal plane: left/right along x (left = +x, as seen from the hangar camera),
// up/down along z (up = +z, towards the opening). No manual hoist: only the assembly raises and lowers the magnet
const CRANE_KEYS = {
	ArrowLeft: ['x', 1],
	ArrowRight: ['x', -1],
	ArrowUp: ['z', 1],
	ArrowDown: ['z', -1],
};
const craneKeys = new Set();

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

	// The crane does not cast: it would black out the ship under the spot light. Once it carries parts, moving them
	// must call shadows.markDirty().
	crane = buildCrane(materials);
	scene.add(crane);

	cameras = createCameras({ renderer, fuselage, crane, hint: document.getElementById('walk-hint') });
	renderPass.camera = cameras.active;
	cameras.onChange((index) => {
		renderPass.camera = cameras.active;
		config.view.camera = index;
		menu?.refresh();
	});

	// Parts are pieces: mounted on the ship, or laid on the floor for the crane (menu Assembly → pieces)
	loadout = createLoadout(fuselage, materials);
	layout = createFloorLayout(scene, materials, shadows);
	const applyLayout = () => {
		if (config.assembly.layout === 'floor') {
			// Wings park closed: their S-foil hardpoints would move away from the measured floor pose
			wingFold.t = wingFold.target = 0;
			loadout.setWingsOpen(0);
			layout.placeOnFloor(loadout.pieces(), loadout);
		} else {
			layout.placeOnShip(loadout.pieces(), loadout);
		}
		shipShadows();
		shadows.markDirty();
	};
	// Edits need the mounted ship (builders and wing hardpoint sockets live on it), so go back to it first and
	// restore the floor layout afterwards
	const edit = (change) => () => {
		const onFloor = config.assembly.layout === 'floor';
		if (onFloor) layout.placeOnShip(loadout.pieces(), loadout);
		change();
		shipShadows();
		if (onFloor) applyLayout();
	};
	const equipWings = edit(() => loadout.equipWings(config.wing.variant, config.wing.params));
	const equipPart = (kind) =>
		edit(() => {
			try {
				loadout.equip(kind, config[kind].variant, config[kind].hardpoint);
			} catch (error) {
				console.warn(error.message);
			}
		});
	const equipWeapon = equipPart('weapon');
	const equipThruster = equipPart('thruster');
	equipWings();
	equipWeapon();
	equipThruster();
	menu = createMenu(config, {
		onWingChange: equipWings,
		onWingToggle: () => toggleWings(),
		onLayoutChange: (value) => {
			config.assembly.layout = value;
			applyLayout();
		},
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
	if (event.code in CRANE_KEYS) {
		event.preventDefault();
		craneKeys.add(event.code);
		updateCraneInput();
	}
	if (event.code === 'KeyT') toggle(gear);
	if (event.code === 'KeyO') toggleWings();
	if (event.code === 'KeyC') cameras.next();
	const digit = /^Digit([1-7])$/.exec(event.code);
	if (digit) cameras.set(Number(digit[1]) - 1);
}

function onKeyUp(event) {
	if (craneKeys.delete(event.code)) updateCraneInput();
}

function updateCraneInput() {
	const input = { x: 0, z: 0 };
	for (const code of craneKeys) {
		const [axis, sign] = CRANE_KEYS[code];
		input[axis] += sign;
	}
	crane.userData.setInput(input);
}

// Wings stay closed while the pieces are on the floor
function toggleWings() {
	if (config.assembly.layout !== 'floor') toggle(wingFold);
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

	crane.userData.update(dt);
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
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => {
	craneKeys.clear();
	updateCraneInput();
});
onResize();
animate();
