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
 * The six cameras of the brief (keys 1-6, `C` cycles). Only the active camera's controls are enabled.
 *
 * - `fuselage`: the ship root (the ship orbital, pilot and chase cameras follow it).
 * - `craneAnchor`: an `Object3D` on the crane's moving element; the crane camera follows it and looks below it at the
 *   carried part.
 *
 * Returns `{ list, active, index, set(i), next(), update(dt), resize(width, height), onChange(cb) }`.
 */
export function createCameras({ renderer, fuselage, craneAnchor, hint }) {
	const dom = renderer.domElement;
	const perspective = (fov = 60, near = 0.1) => new THREE.PerspectiveCamera(fov, 1, near, FAR);
	const shipCentre = () => fuselage.localToWorld(new THREE.Vector3(0, 1.5, 0));

	const list = [
		hangarOrbital(perspective(), dom),
		shipOrbital(perspective(), dom, shipCentre),
		craneFollow(perspective(), craneAnchor),
		pilot(perspective(70, 0.1), dom, fuselage),
		shipChase(perspective(), fuselage),
		firstPerson(perspective(70), dom, hint),
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
	const controls = new OrbitControls(camera, dom);
	controls.enableDamping = true;
	controls.minDistance = 3;
	controls.maxDistance = 20;
	controls.maxPolarAngle = Math.PI * 0.6;
	controls.enabled = false;
	let placed = false;
	const entry = orbitalEntry('ship', 'Ship orbital', camera, controls);
	entry.enter = () => {
		controls.enabled = true;
		// The ship may have moved since the last visit: keep the view offset, move the target
		const target = shipCentre();
		if (!placed) {
			camera.position.copy(target).add(new THREE.Vector3(7, 3.5, -8));
			placed = true;
		} else {
			camera.position.add(target.clone().sub(controls.target));
		}
		controls.target.copy(target);
		controls.update();
	};
	return entry;
}

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

/** 3 - Crane follow: beside the crane's moving element, looking down at the part it carries. */
function craneFollow(camera, anchor) {
	const offset = new THREE.Vector3(3, 1.5, 3);
	const lookDrop = new THREE.Vector3(0, -3, 0);
	const anchorPosition = new THREE.Vector3();
	const look = new THREE.Vector3();
	const place = () => {
		anchor.getWorldPosition(anchorPosition);
		camera.position.copy(anchorPosition).add(offset);
		camera.lookAt(look.copy(anchorPosition).add(lookDrop));
	};
	return { id: 'crane', label: 'Crane follow', camera, enter: place, update: place };
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
	const defaultFov = camera.fov;
	let active = false;
	let dragging = false;
	let yaw = 0;
	let pitch = 0;

	const apply = () => {
		camera.rotation.set(pitch, yaw, 0);
	};
	const reset = () => {
		yaw = pitch = 0;
		camera.fov = defaultFov;
		camera.updateProjectionMatrix();
		apply();
	};

	dom.addEventListener('pointerdown', (event) => {
		if (!active || event.button !== 0) return;
		dragging = true;
		dom.setPointerCapture(event.pointerId);
	});
	dom.addEventListener('pointermove', (event) => {
		if (!active || !dragging) return;
		// Drag the view like grabbing it: moving right turns the head left, as in the orbital cameras
		yaw = THREE.MathUtils.clamp(yaw + event.movementX * PILOT_LOOK.sensitivity, -PILOT_LOOK.yaw, PILOT_LOOK.yaw);
		// The further the head turns, the less it may look down
		const turn = Math.abs(yaw) / PILOT_LOOK.yaw;
		const pitchDown = THREE.MathUtils.lerp(PILOT_LOOK.pitchDown, PILOT_LOOK.pitchDownSide, turn);
		pitch = THREE.MathUtils.clamp(pitch + event.movementY * PILOT_LOOK.sensitivity, -pitchDown, PILOT_LOOK.pitchUp);
		apply();
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
			if (!active) return;
			event.preventDefault();
			camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.03, PILOT_LOOK.minFov, PILOT_LOOK.maxFov);
			camera.updateProjectionMatrix();
		},
		{ passive: false }
	);
	dom.addEventListener('dblclick', () => active && reset());

	return {
		id: 'pilot',
		label: 'Pilot',
		camera,
		enter: () => (active = true),
		exit: () => {
			active = false;
			dragging = false;
		},
	};
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
