import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

import { HANGAR } from '../hangar/hangar.js';
import { PLATFORM } from '../hangar/platform.js';

const FAR = 5000;
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4;
const RUN_SPEED = 8;
// First person: keep away from the walls and step around the platform instead of through it
const WALL_MARGIN = 1;
const PLATFORM_MARGIN = PLATFORM.size / 2 + 0.3;

/**
 * The cameras (keys 1-7, `C` cycles): the six of the brief plus the camera under the crane magnet. Only the active camera's controls are enabled.
 *
 * - `fuselage`: the ship root (the ship orbital, pilot and chase cameras follow it).
 * - `crane`: the crane root (src/app/crane.js); the crane camera rides on its magnet.
 *
 * Returns `{ list, active, index, set(i), next(), update(dt), resize(width, height), onChange(cb) }`.
 */
export function createCameras({ renderer, fuselage, crane, hint }) {
	const dom = renderer.domElement;
	const perspective = (fov = 60, near = 0.1) => new THREE.PerspectiveCamera(fov, 1, near, FAR);
	const shipCentre = () => fuselage.localToWorld(new THREE.Vector3(0, 1.5, 0));
	const magnetCentre = () => crane.userData.magnet.getWorldPosition(new THREE.Vector3());

	const list = [
		hangarOrbital(perspective(), dom),
		shipOrbital(perspective(), dom, shipCentre),
		craneOrbital(perspective(), dom, magnetCentre),
		pilot(perspective(70, 0.1), dom, fuselage),
		shipChase(perspective(), fuselage),
		firstPerson(perspective(70), dom, hint),
		craneTip(perspective(75, 0.05), dom, crane),
	];

	const listeners = [];
	const state = {
		list,
		index: 0,
		get active() {
			return list[state.index].camera;
		},
		set(index) {
			if (index < 0 || index >= list.length) return;
			list[state.index].exit?.();
			state.index = index;
			list[index].enter?.();
			listeners.forEach((listener) => listener(index));
		},
		next() {
			state.set((state.index + 1) % list.length);
		},
		update(dt) {
			list[state.index].update?.(dt);
		},
		/** Every camera keeps the window aspect, not only the active one. */
		resize(width, height) {
			for (const { camera } of list) {
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
			}
		},
		onChange(listener) {
			listeners.push(listener);
		},
	};

	list.forEach((entry, i) => {
		if (entry.controls) entry.controls.enabled = i === 0;
	});
	list[0].enter?.();
	return state;
}

/** 1 - Hangar orbital: from the back of the hangar looking out through the opening. */
function hangarOrbital(camera, dom) {
	camera.position.set(0, 7, -HANGAR.depth / 2 + 4);
	const controls = new OrbitControls(camera, dom);
	controls.target.set(0, 5, 4);
	controls.enableDamping = true;
	controls.maxDistance = 40;
	controls.maxPolarAngle = Math.PI * 0.55;
	controls.enabled = false;
	controls.update();
	return orbitalEntry('hangar', 'Hangar orbital', camera, controls);
}

/** 2 - Ship orbital: around the ship's centre, close enough to inspect the parts. */
function shipOrbital(camera, dom, shipCentre) {
	return followOrbital('ship', 'Ship orbital', camera, dom, shipCentre, {
		offset: new THREE.Vector3(7, 3.5, -8),
		minDistance: 3,
		maxDistance: 20,
	});
}

/** 3 - Crane orbital: around the crane magnet, following it while it travels and swings. */
function craneOrbital(camera, dom, magnetCentre) {
	return followOrbital('crane-orbit', 'Crane orbital', camera, dom, magnetCentre, {
		offset: new THREE.Vector3(5, 2, -6),
		minDistance: 2,
		maxDistance: 16,
		follow: true,
	});
}

/**
 * Orbit controls around a target that moves. The camera keeps its offset from the target: on entering (the target
 * may have moved since the last visit) and, with `follow`, every frame, so it is carried along with the target.
 */
function followOrbital(id, label, camera, dom, getTarget, { offset, minDistance, maxDistance, follow = false }) {
	const controls = new OrbitControls(camera, dom);
	controls.enableDamping = true;
	controls.minDistance = minDistance;
	controls.maxDistance = maxDistance;
	controls.maxPolarAngle = Math.PI * 0.6;
	controls.enabled = false;
	let placed = false;
	const track = () => {
		const target = getTarget();
		camera.position.add(target.clone().sub(controls.target));
		controls.target.copy(target);
	};
	const entry = orbitalEntry(id, label, camera, controls);
	entry.enter = () => {
		controls.enabled = true;
		if (!placed) {
			controls.target.copy(getTarget());
			camera.position.copy(controls.target).add(offset);
			placed = true;
		} else {
			track();
		}
		controls.update();
	};
	if (follow) {
		entry.update = () => {
			track();
			controls.update();
		};
	}
	return entry;
}

/** Camera list entry for an `OrbitControls` camera: controls on while active, damped update every frame. */
function orbitalEntry(id, label, camera, controls) {
	return {
		id,
		label,
		camera,
		controls,
		enter: () => (controls.enabled = true),
		exit: () => (controls.enabled = false),
		update: () => controls.update(),
	};
}

// Crane camera: looks down from the magnet, tilted forward towards +z, so screen up = +z and screen left = +x (the
// arrow keys move the crane the same way). Looking around turns freely; the pitch goes from straight down to just
// below the horizon (to the magnet's underside when looking back over it).
const CRANE_TILT = THREE.MathUtils.degToRad(20);
const CRANE_SHAKE = 0.0025; // radians of motor vibration at full speed
const CRANE_LOOK = {
	pitchUp: THREE.MathUtils.degToRad(65), // relative to the default view: 5° below the horizon
	pitchUpBack: THREE.MathUtils.degToRad(45), // looking back over the magnet: its disc hides the horizon
	pitchDown: CRANE_TILT, // straight down
	sensitivity: 0.004,
	minFov: 30,
	maxFov: 90,
};

/**
 * 7 - Crane magnet: a camera fixed under the magnet. It rides the whole chain (bridge → trolley → swinging cable), so
 * the view lags and sways when the crane starts and stops, and trembles slightly while the motors run. Drag to look
 * around, wheel to zoom, double-click to look ahead again.
 */
function craneTip(camera, dom, crane) {
	const { cameraMount, speed, maxSpeed } = crane.userData;
	cameraMount.add(camera);
	camera.rotation.order = 'YXZ';
	const basePitch = -Math.PI / 2 + CRANE_TILT;
	const look = dragLook(dom, camera, {
		...CRANE_LOOK,
		clamp(yaw, pitch) {
			// Free turn, kept in [-π, π] so the pitch limit below can tell front from back
			yaw = THREE.MathUtils.euclideanModulo(yaw + Math.PI, 2 * Math.PI) - Math.PI;
			const back = Math.max(0, (Math.abs(yaw) - Math.PI / 2) / (Math.PI / 2));
			const pitchUp = THREE.MathUtils.lerp(CRANE_LOOK.pitchUp, CRANE_LOOK.pitchUpBack, back);
			return [yaw, THREE.MathUtils.clamp(pitch, -CRANE_LOOK.pitchDown, pitchUp)];
		},
	});
	let time = 0;
	const apply = (shake = 0) => {
		const pitchShake = shake * Math.sin(time * 41) * Math.sin(time * 7.3);
		camera.rotation.set(basePitch + look.pitch + pitchShake, Math.PI + look.yaw, shake * Math.sin(time * 33 + 1.7));
	};
	apply();
	return {
		id: 'crane',
		label: 'Crane magnet',
		camera,
		enter: () => look.setActive(true),
		exit: () => look.setActive(false),
		update(dt) {
			time += dt;
			apply(CRANE_SHAKE * Math.min(speed() / maxSpeed, 1));
		},
	};
}

// Pilot head limits, relative to the anchor (which already looks at the dashboard, slightly down)
const PILOT_LOOK = {
	yaw: THREE.MathUtils.degToRad(80), // out of the side windows, not back through the headrest
	pitchUp: THREE.MathUtils.degToRad(40), // up through the canopy
	pitchDown: THREE.MathUtils.degToRad(30), // down to the lower dashboard, looking ahead
	pitchDownSide: THREE.MathUtils.degToRad(8), // looking sideways: lower would look into the pilot's own shoulder
	sensitivity: 0.004, // radians per dragged pixel
	minFov: 35, // zoom in to read the screens
	maxFov: 80,
};

/**
 * 4 - Pilot: rides on the fuselage's camera anchor, at the pilot's eyes, facing the dashboard and windshield. Drag
 * to turn the head within the limits a seated pilot has, wheel to zoom, double-click to look ahead again.
 */
function pilot(camera, dom, fuselage) {
	fuselage.userData.pilotCameraAnchor.add(camera);
	camera.rotation.order = 'YXZ';
	const look = dragLook(dom, camera, {
		...PILOT_LOOK,
		clamp(yaw, pitch) {
			yaw = THREE.MathUtils.clamp(yaw, -PILOT_LOOK.yaw, PILOT_LOOK.yaw);
			// The further the head turns, the less it may look down
			const turn = Math.abs(yaw) / PILOT_LOOK.yaw;
			const pitchDown = THREE.MathUtils.lerp(PILOT_LOOK.pitchDown, PILOT_LOOK.pitchDownSide, turn);
			return [yaw, THREE.MathUtils.clamp(pitch, -pitchDown, PILOT_LOOK.pitchUp)];
		},
		onChange: (yaw, pitch) => camera.rotation.set(pitch, yaw, 0),
	});
	return {
		id: 'pilot',
		label: 'Pilot',
		camera,
		enter: () => look.setActive(true),
		exit: () => look.setActive(false),
	};
}

/**
 * Mouse look for a camera riding on a moving anchor (pilot, crane): drag turns the view by a yaw/pitch offset from
 * the anchor's own orientation, wheel zooms (fov), double-click recentres. Only reacts while active.
 *
 * `clamp(yaw, pitch) → [yaw, pitch]` applies the camera's limits; `onChange(yaw, pitch)` is called after every change
 * (cameras that rebuild their rotation each frame can read `yaw`/`pitch` instead).
 */
function dragLook(dom, camera, { sensitivity, minFov, maxFov, clamp, onChange = () => {} }) {
	const defaultFov = camera.fov;
	let dragging = false;
	const look = {
		yaw: 0,
		pitch: 0,
		active: false,
		setActive(active) {
			look.active = active;
			if (!active) dragging = false;
		},
	};
	const reset = () => {
		look.yaw = look.pitch = 0;
		camera.fov = defaultFov;
		camera.updateProjectionMatrix();
		onChange(0, 0);
	};

	dom.addEventListener('pointerdown', (event) => {
		if (!look.active || event.button !== 0) return;
		dragging = true;
		dom.setPointerCapture(event.pointerId);
	});
	dom.addEventListener('pointermove', (event) => {
		if (!look.active || !dragging) return;
		// Drag the view like grabbing it: moving right turns the head left, as in the orbital cameras
		[look.yaw, look.pitch] = clamp(
			look.yaw + event.movementX * sensitivity,
			look.pitch + event.movementY * sensitivity
		);
		onChange(look.yaw, look.pitch);
	});
	const endDrag = (event) => {
		dragging = false;
		if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId);
	};
	dom.addEventListener('pointerup', endDrag);
	dom.addEventListener('pointercancel', endDrag);
	dom.addEventListener(
		'wheel',
		(event) => {
			if (!look.active) return;
			event.preventDefault();
			camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.03, minFov, maxFov);
			camera.updateProjectionMatrix();
		},
		{ passive: false }
	);
	dom.addEventListener('dblclick', () => look.active && reset());
	return look;
}

/** 5 - Ship chase: behind and above the tail in the ship's frame, smoothed so it trails the ship when it moves. */
function shipChase(camera, fuselage) {
	const offset = new THREE.Vector3(0, 3, -11);
	const lookAhead = new THREE.Vector3(0, 1, 3);
	const desired = new THREE.Vector3();
	const look = new THREE.Vector3();
	const aim = () => {
		fuselage.localToWorld(desired.copy(offset));
		fuselage.localToWorld(look.copy(lookAhead));
	};
	return {
		id: 'chase',
		label: 'Ship chase',
		camera,
		enter() {
			aim();
			camera.position.copy(desired);
			camera.lookAt(look);
		},
		update(dt) {
			aim();
			// Frame-rate independent exponential smoothing
			camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
			camera.lookAt(look);
		},
	};
}

/** 6 - First person: walk on the hangar floor with WASD (Shift runs), look with the mouse (click to lock). */
function firstPerson(camera, dom, hint) {
	camera.position.set(-8, EYE_HEIGHT, 12);
	camera.lookAt(0, 1.5, 0);
	const controls = new PointerLockControls(camera, dom);
	const keys = new Set();
	let active = false;

	const onClick = () => active && !controls.isLocked && controls.lock();
	const onKeyDown = (event) => keys.add(event.code);
	const onKeyUp = (event) => keys.delete(event.code);
	dom.addEventListener('click', onClick);
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', () => keys.clear());

	const showHint = (visible) => hint && (hint.style.display = visible ? 'block' : 'none');
	controls.addEventListener('lock', () => showHint(false));
	controls.addEventListener('unlock', () => showHint(active));

	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const move = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);

	return {
		id: 'walk',
		label: 'First person',
		camera,
		enter() {
			active = true;
			showHint(true);
		},
		exit() {
			active = false;
			showHint(false);
			if (controls.isLocked) controls.unlock();
		},
		update(dt) {
			// Walk on the floor plane: the view direction projected on XZ, whatever the pitch
			camera.getWorldDirection(forward);
			forward.y = 0;
			forward.normalize();
			right.crossVectors(forward, up);
			move.set(0, 0, 0);
			if (keys.has('KeyW')) move.add(forward);
			if (keys.has('KeyS')) move.sub(forward);
			if (keys.has('KeyD')) move.add(right);
			if (keys.has('KeyA')) move.sub(right);
			if (move.lengthSq() > 0) {
				const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
				camera.position.addScaledVector(move.normalize(), speed * dt);
			}
			constrain(camera.position);
		},
	};
}

/** Keeps the walker inside the hangar, at eye height, and out of the platform square. */
function constrain(position) {
	const halfW = HANGAR.width / 2 - WALL_MARGIN;
	const halfD = HANGAR.depth / 2 - WALL_MARGIN;
	position.x = THREE.MathUtils.clamp(position.x, -halfW, halfW);
	position.z = THREE.MathUtils.clamp(position.z, -halfD, halfD);
	position.y = EYE_HEIGHT;

	// Inside the platform square: push out through the nearest side
	const dx = PLATFORM_MARGIN - Math.abs(position.x);
	const dz = PLATFORM_MARGIN - Math.abs(position.z);
	if (dx > 0 && dz > 0) {
		if (dx < dz) position.x = Math.sign(position.x || 1) * PLATFORM_MARGIN;
		else position.z = Math.sign(position.z || 1) * PLATFORM_MARGIN;
	}
}
