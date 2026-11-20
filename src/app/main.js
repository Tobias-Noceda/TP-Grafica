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
import { createAssembly } from './assembly.js';

let container, renderer, scene, cameras, renderPass, composer, bloomPass, space, fuselage, loadout, shadows, menu;
let crane, layout, assembly;
let generate, reset, complete, togglePause;
let fireTimer = 0; // s left during which firing keeps re-rendering the shadows (minigun rotor turning)
let triggerHeld = false; // P held down: automatic fire
let nextShot = 0; // s until the next automatic shot
const FIRE_INTERVAL = 0.15; // s between shots while P is held (the minigun turns one barrel in 0.12 s)
// 'preview' (live edits), 'assembling' (sequence running or paused), 'flight' (assembled ship, locked; P fires)
let mode = 'preview';
let paused = false;
const clock = new THREE.Clock();

// Ship configuration edited by the menu
const config = {
	wing: { variant: 'xwing', params: { ...PART_KINDS.wing.xwing.defaults } },
	weapon: { variant: 'machineGun', hardpoint: 'nose' },
	thruster: { variant: 'rearEngine', hardpoint: 'rear' },
	view: { camera: 0, shadows: 'low' },
	// Where the pieces are (preview only), sequence speed (x1, x2, x4) and a status line for the menu
	assembly: { layout: 'ship', speed: 1, status: 'Idle' },
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

/** Renderer (ACES tone mapping), scene, studio environment for reflections, shadows and the bloom post-processing chain. */
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

/**
 * Builds the hangar, platform, fuselage, crane and space, then the loadout, floor layout, assembly sequence, cameras
 * and menu, and defines the app actions (live edits in preview, Generate, Complete, Reset, pause).
 */
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
		if (mode !== 'preview') return;
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

	// Generate / Reset: the sequence works on pieces laid on the floor and the loadout is rebuilt from `config`
	const buildAll = () => {
		loadout.equipWings(config.wing.variant, config.wing.params);
		for (const kind of ['weapon', 'thruster']) {
			try {
				loadout.equip(kind, config[kind].variant, config[kind].hardpoint);
			} catch (error) {
				console.warn(error.message);
			}
		}
	};
	generate = () => {
		if (mode === 'assembling' && assembly.phase !== 'idle') assembly.cancel();
		loadout.disposeAll();
		layout.clear();
		buildAll();
		wingFold.t = wingFold.target = 0;
		loadout.setWingsOpen(0);
		layout.placeOnFloor(loadout.pieces(), loadout);
		shipShadows();
		shadows.markDirty();
		paused = false;
		setMode('assembling');
		assembly.start(loadout.pieces());
	};
	// Back to the start: the ship rebuilt from the config on the platform, parts menu live
	reset = () => {
		if (assembly.phase === 'running') assembly.cancel();
		loadout.disposeAll();
		layout.clear();
		paused = false;
		config.assembly.layout = 'ship';
		wingFold.t = wingFold.target = 0;
		buildAll();
		loadout.setWingsOpen(0);
		applyLayout();
		setMode('preview');
		menu?.refresh();
	};
	complete = () => {
		if (mode === 'assembling') assembly.complete();
	};
	togglePause = () => {
		if (mode !== 'assembling') return;
		paused = !paused;
		syncMenu();
	};
	assembly = createAssembly({
		crane,
		loadout,
		fuselage,
		layout,
		shadows,
		onDone: () => {
			paused = false;
			config.assembly.layout = 'ship';
			shipShadows();
			shadows.markDirty();
			setMode('flight');
			menu?.refresh();
		},
	});

	menu = createMenu(config, {
		onGenerate: generate,
		onTogglePause: togglePause,
		onComplete: complete,
		onReset: reset,
		onWingChange: equipWings,
		onWingToggle: () => toggleWings(),
		onLayoutChange: (value) => {
			config.assembly.layout = value;
			if (mode === 'preview') applyLayout();
		},
		onWeaponChange: equipWeapon,
		onThrusterChange: equipThruster,
		cameraOptions: Object.fromEntries(cameras.list.map(({ label }, i) => [`${i + 1}. ${label}`, i])),
		onCameraChange: (index) => cameras.set(index),
		onShadowsChange: (level) => shadows.setQuality(level),
	});

	syncMenu();
	space = buildSpace();
	scene.add(space.group);
}

/** Pushes the app mode and pause state to the menu (folder visibility, button titles). */
function syncMenu() {
	menu?.setMode({ mode, paused });
}

/** Switches the app mode: 'preview' (live edits), 'assembling' (sequence running or paused) or 'flight' (assembled). */
function setMode(next) {
	mode = next;
	syncMenu();
}

/** Keeps every camera, the renderer and the post-processing chain at the container size. */
function onResize() {
	const width = container.offsetWidth;
	const height = container.offsetHeight;

	cameras.resize(width, height);

	renderer.setSize(width, height);
	composer.setSize(width, height);
	bloomPass.resolution.set(width, height);
}

/** Keyboard: arrows drive the crane, SPACE pauses the assembly, P fires (held: automatic; flight only), T gear, O wings, C / 1-7 cameras. */
function onKeyDown(event) {
	// Typing in a menu field must not switch cameras or toggle parts
	if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
	if (event.code in CRANE_KEYS) {
		event.preventDefault();
		craneKeys.add(event.code);
		updateCraneInput();
	}
	if (event.code === 'Space') {
		event.preventDefault();
		togglePause?.();
	}
	if (event.code === 'KeyT') toggle(gear);
	if (event.code === 'KeyO') toggleWings();
	if (event.code === 'KeyP' && !event.repeat) {
		// First shot right away, then one every FIRE_INTERVAL until the key is released (see animate)
		triggerHeld = true;
		nextShot = FIRE_INTERVAL;
		fireGuns();
	}
	if (event.code === 'KeyC') cameras.next();
	const digit = /^Digit([1-7])$/.exec(event.code);
	if (digit) cameras.set(Number(digit[1]) - 1);
}

/** Releases a crane arrow key. */
function onKeyUp(event) {
	if (event.code === 'KeyP') triggerHeld = false;
	if (craneKeys.delete(event.code)) updateCraneInput();
}

/** Turns the arrow keys held down into the crane's horizontal input (opposite keys cancel out). */
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
	if ((mode === 'preview' && config.assembly.layout !== 'floor') || mode === 'flight') toggle(wingFold);
}

/** Fires every mounted gun (spark at the muzzle; the minigun also turns by one barrel). Only in flight mode. */
function fireGuns() {
	if (mode !== 'flight') return;
	for (const piece of loadout.pieces()) if (piece.kind === 'weapon') piece.part.userData.fire?.();
	fireTimer = 0.3;
}

/** Flips a toggle animation's target between 0 and 1. */
function toggle(state) {
	state.target = 1 - state.target;
}

/** Moves a toggle animation towards its target in `duration` seconds and applies it with smoothstep easing. */
function stepToggle(state, dt, apply) {
	if (state.t === state.target) return;
	const step = dt / state.duration;
	state.t = state.target > state.t ? Math.min(state.t + step, state.target) : Math.max(state.t - step, state.target);
	apply(THREE.MathUtils.smoothstep(state.t, 0, 1));
}

/**
 * Frame loop. The crane and the assembly get the speed-scaled, pause-aware dt while a sequence runs; cameras, gear,
 * wings, space and rendering always use the real dt. Shadows are re-rendered only when marked dirty.
 */
function animate() {
	requestAnimationFrame(animate);
	const dt = clock.getDelta();

	const phase = assembly.phase;
	const simDt = phase === 'running' ? (paused ? 0 : dt * config.assembly.speed) : dt;
	crane.userData.update(simDt);
	if (phase === 'running' || phase === 'resetting') assembly.update(simDt);
	config.assembly.status = assembly.status() + (mode === 'assembling' && paused ? ' (paused)' : '');
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
	// Automatic fire while P is held, then gun sparks and minigun rotor steps
	if (triggerHeld && mode === 'flight') {
		nextShot -= dt;
		if (nextShot <= 0) {
			nextShot += FIRE_INTERVAL;
			fireGuns();
		}
	}
	for (const piece of loadout.pieces()) if (piece.kind === 'weapon') piece.part.userData.update?.(dt);
	if (fireTimer > 0) {
		fireTimer -= dt;
		shadows.markDirty();
	}
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
	triggerHeld = false;
	updateCraneInput();
});
onResize();
animate();
