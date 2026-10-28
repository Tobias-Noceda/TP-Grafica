import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js';
import { Pane } from 'tweakpane';

import { createMaterials } from '../app/materials.js';
import { buildSpace } from '../scene/space.js';
import { buildFuselage } from '../parts/fuselage.js';
import { buildLandingGear } from '../parts/landingGear.js';
import { thrusterVariants } from '../parts/thrusters.js';
import { weaponVariants } from '../parts/weapons.js';
import { wingVariants } from '../parts/wings.js';

// Gap between two pieces in a row, and z of each row (big pieces at the back, small ones in front), in metres
const GAP = 1.6;
const ROWS_Z = [0, 4.5];

let container, renderer, labelRenderer, scene, camera, controls, composer, bloomPass, space, materials;
const clock = new THREE.Clock();
const gallery = new THREE.Group();
const normalsHelpers = new THREE.Group();
const view = { wireframe: false, normals: false, focus: 'all' };

/**
 * Pieces on display. Variants come from the same `src/parts/*` registries as the main scene; `params` is edited by the
 * menu and `build(params)` rebuilds the piece. Wings are shown for the left side, as they are built.
 */
const pieces = [
	{ id: 'fuselage', label: 'Fuselage + cockpit (fixed)', row: 0, build: () => buildFuselage(materials) },
	...Object.entries(wingVariants).map(([id, variant]) => ({
		id: `wing-${id}`,
		label: `Wing: ${variant.label}`,
		row: 0,
		variant,
		params: { ...variant.defaults },
		build: (params) => variant.build(params, materials),
		...(variant.opens && {
			label: `Wing: ${variant.label} (click or O: open / close)`,
			open: 1,
			// Same eased toggle as the main scene: `t` moves to `target` in `duration` seconds, `open` is smoothstep(t)
			fold: { t: 1, target: 1, duration: 1.2 },
		}),
	})),
	...Object.entries(weaponVariants).map(([id, variant]) => ({
		id: `weapon-${id}`,
		label: `Weapon: ${variant.label}`,
		row: 1,
		variant,
		params: { ...variant.defaults },
		build: (params) => variant.build(params, materials, { outward: new THREE.Vector3(1, 0, 0) }),
	})),
	// Thrusters point their nozzle towards the default camera (+z) so the exhaust is visible
	...Object.entries(thrusterVariants).map(([id, variant]) => ({
		id: `thruster-${id}`,
		label: `Thruster: ${variant.label}`,
		row: 1,
		variant,
		params: { ...variant.defaults },
		build: (params) => variant.build(params, materials, { outward: new THREE.Vector3(0, 0, 1) }),
	})),
	{
		id: 'landing-gear',
		label: 'Landing gear',
		row: 1,
		deploy: 1,
		build: () => buildLandingGear(materials, { height: 1.3 }),
	},
];

function setupThreeJs() {
	container = document.getElementById('container3D');

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	container.appendChild(renderer.domElement);

	labelRenderer = new CSS2DRenderer();
	labelRenderer.domElement.style.position = 'absolute';
	labelRenderer.domElement.style.top = '0';
	labelRenderer.domElement.style.pointerEvents = 'none';
	container.appendChild(labelRenderer.domElement);

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);

	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
	pmrem.dispose();

	// Kept low: the white hull paint must stay under the bloom threshold, only the emissive parts glow
	scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242a, 0.5));
	const key = new THREE.DirectionalLight(0xffffff, 1.1);
	key.position.set(6, 10, 8);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0x9fc4ff, 0.5);
	rim.position.set(-8, 4, -10);
	scene.add(rim);

	camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;

	composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.9);
	composer.addPass(bloomPass);
	composer.addPass(new OutputPass());

	window.addEventListener('resize', onResize);
	window.addEventListener('keydown', (event) => {
		if (event.code === 'KeyO') pieces.forEach(toggleFold);
	});
	setupPicking();
	onResize();
}

function buildScene() {
	materials = createMaterials(renderer);

	space = buildSpace();
	scene.add(space.group);

	const grid = new THREE.GridHelper(60, 60, 0x2f6f80, 0x1a2a33);
	grid.material.transparent = true;
	grid.material.opacity = 0.5;
	scene.add(grid);

	scene.add(gallery, normalsHelpers);
	for (const piece of pieces) {
		piece.holder = new THREE.Group();
		piece.holder.name = piece.id;
		const label = document.createElement('div');
		label.className = 'part-label';
		label.textContent = piece.label;
		piece.labelObject = new CSS2DObject(label);
		piece.holder.add(piece.labelObject);
		gallery.add(piece.holder);
		rebuild(piece, false);
	}
	layout();
	focus('all');
}

/**
 * Replaces a piece's object with a fresh build from its params, disposing the old geometries (materials are shared).
 */
function rebuild(piece, relayout = true) {
	if (piece.object) {
		piece.holder.remove(piece.object);
		piece.object.traverse((child) => child.geometry?.dispose());
	}
	piece.object = piece.build(piece.params);
	piece.holder.add(piece.object);
	applyPose(piece);
	if (relayout) layout();
	updateNormals();
}

function applyPose(piece) {
	if (piece.open !== undefined) piece.object.userData.setOpen?.(piece.open);
	if (piece.deploy !== undefined) piece.object.userData.setDeploy?.(piece.deploy);
}

/**
 * Lays the pieces out in rows along x (see `ROWS_Z`), each row centred on x = 0. Every piece stands on the grid
 * (y = 0), centred in z on its row, with its label above it.
 */
function layout() {
	ROWS_Z.forEach((z, row) => {
		const inRow = pieces.filter((piece) => piece.row === row);
		const boxes = inRow.map((piece) => {
			piece.object.position.set(0, 0, 0);
			piece.object.updateMatrixWorld(true);
			return new THREE.Box3().setFromObject(piece.object);
		});
		const total = boxes.reduce((sum, box) => sum + box.max.x - box.min.x, 0) + GAP * (inRow.length - 1);
		let cursor = -total / 2;
		inRow.forEach((piece, i) => {
			const box = boxes[i];
			const width = box.max.x - box.min.x;
			const height = box.max.y - box.min.y;
			piece.object.position.set(-box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2);
			piece.holder.position.set(cursor, 0, z);
			piece.labelObject.position.set(width / 2, height + 0.4, 0);
			piece.center = new THREE.Vector3(cursor + width / 2, height / 2, z);
			piece.size = box.getSize(new THREE.Vector3()).length();
			cursor += width + GAP;
		});
	});
	gallery.updateMatrixWorld(true);
}

/**
 * Points the orbit camera at one piece (or the whole row), from the front-right and slightly above.
 */
function focus(id) {
	const target = new THREE.Vector3();
	let distance;
	if (id === 'all') {
		const box = new THREE.Box3().setFromObject(gallery);
		box.getCenter(target);
		distance = box.getSize(new THREE.Vector3()).length() * 0.75;
	} else {
		const piece = pieces.find((p) => p.id === id);
		target.copy(piece.center);
		distance = Math.max(piece.size * 1.3, 2.5);
	}
	controls.target.copy(target);
	camera.position.copy(target).add(new THREE.Vector3(0.45, 0.35, 1).normalize().multiplyScalar(distance));
	controls.update();
}

function setWireframe(enabled) {
	for (const material of Object.values(materials)) {
		if (material.isMaterial) material.wireframe = enabled;
	}
}

/**
 * Vertex normal helpers for every mesh of the pieces, rebuilt when a piece changes. Useful to check the generated
 * surfaces (outward normals, hard edges on knots).
 */
function updateNormals() {
	for (const helper of normalsHelpers.children) helper.dispose();
	normalsHelpers.clear();
	if (!view.normals) return;
	gallery.updateMatrixWorld(true);
	gallery.traverse((child) => {
		if (child.isMesh) normalsHelpers.add(new VertexNormalsHelper(child, 0.04, 0x00ff88));
	});
}

function toggleFold(piece) {
	if (piece.fold) piece.fold.target = 1 - piece.fold.target;
}

function stepFold(piece, dt) {
	const { fold } = piece;
	if (!fold || fold.t === fold.target) return;
	const step = dt / fold.duration;
	fold.t = fold.target > fold.t ? Math.min(fold.t + step, fold.target) : Math.max(fold.t - step, fold.target);
	piece.open = THREE.MathUtils.smoothstep(fold.t, 0, 1);
	applyPose(piece);
	// Tweakpane may report the refresh as a change; the flag keeps the slider handler from stopping the animation
	piece.refreshing = true;
	piece.openBinding?.refresh();
	piece.refreshing = false;
}

/**
 * Clicking a piece that opens (X-wing S-foils) toggles it; the cursor turns into a pointer over it. A press that moved
 * more than a few pixels is an orbit drag, not a click.
 */
function setupPicking() {
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const down = new THREE.Vector2();
	const canvas = renderer.domElement;

	const pieceAt = (event) => {
		const rect = canvas.getBoundingClientRect();
		pointer.set(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);
		const [hit] = raycaster.intersectObject(gallery, true);
		return hit && pieces.find((piece) => piece.fold && isInside(hit.object, piece.holder));
	};

	canvas.addEventListener('pointerdown', (event) => down.set(event.clientX, event.clientY));
	canvas.addEventListener('pointerup', (event) => {
		if (down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
		const piece = pieceAt(event);
		if (piece) toggleFold(piece);
	});
	canvas.addEventListener('pointermove', (event) => {
		if (event.buttons) return;
		canvas.style.cursor = pieceAt(event) ? 'pointer' : '';
	});
}

function isInside(object, ancestor) {
	for (let node = object; node; node = node.parent) if (node === ancestor) return true;
	return false;
}

function createMenu() {
	const pane = new Pane({ title: 'Piezas' });

	const display = pane.addFolder({ title: 'View' });
	const focusOptions = { 'All pieces': 'all', ...Object.fromEntries(pieces.map((p) => [p.label, p.id])) };
	display.addBinding(view, 'focus', { label: 'focus', options: focusOptions }).on('change', () => focus(view.focus));
	display.addBinding(view, 'wireframe').on('change', () => setWireframe(view.wireframe));
	display.addBinding(view, 'normals').on('change', updateNormals);

	for (const piece of pieces) {
		const schema = piece.variant?.paramSchema ?? {};
		if (!Object.keys(schema).length && piece.open === undefined && piece.deploy === undefined) continue;
		const folder = pane.addFolder({ title: piece.label, expanded: false });
		for (const [key, { label, min, max, step }] of Object.entries(schema)) {
			folder.addBinding(piece.params, key, { label, min, max, step }).on('change', () => rebuild(piece));
		}
		// Poses are transforms, not geometry: they move the existing joints without rebuilding
		if (piece.open !== undefined) {
			piece.openBinding = folder.addBinding(piece, 'open', { label: 'open', min: 0, max: 1 });
			piece.openBinding.on('change', () => {
				if (piece.refreshing) return;
				// Dragging the slider takes over from a running animation
				if (piece.fold) piece.fold.t = piece.fold.target = piece.open;
				applyPose(piece);
			});
			if (piece.fold) folder.addButton({ title: 'Open / close (O)' }).on('click', () => toggleFold(piece));
		}
		if (piece.deploy !== undefined) {
			folder.addBinding(piece, 'deploy', { label: 'deploy', min: 0, max: 1 }).on('change', () => {
				applyPose(piece);
				updateNormals();
			});
		}
	}
}

function onResize() {
	const width = container.offsetWidth;
	const height = container.offsetHeight;

	camera.aspect = width / height;
	camera.updateProjectionMatrix();

	renderer.setSize(width, height);
	labelRenderer.setSize(width, height);
	composer.setSize(width, height);
	bloomPass.resolution.set(width, height);
}

function animate() {
	requestAnimationFrame(animate);
	const dt = clock.getDelta();

	controls.update();
	space.update(dt);
	for (const piece of pieces) stepFold(piece, dt);
	for (const helper of normalsHelpers.children) helper.update();
	composer.render(dt);
	labelRenderer.render(scene, camera);
}

setupThreeJs();
buildScene();
createMenu();
animate();
