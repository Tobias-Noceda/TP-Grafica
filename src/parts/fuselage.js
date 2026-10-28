import * as THREE from 'three';

import { buildLandingGear } from './landingGear.js';
import { buildPadCover, mountPart, unmountPart } from './sockets.js';

/**
 * X-wing inspired fuselage, built only from primitives. The nose points to +z, up is +y and the pilot's left is +x.
 *
 * Sections are `{ halfWidth, bottom, top }` in body space (y = 0 is the belly of the rear body).
 */
export const FUSELAGE = {
	clearance: 1.2, // belly height above the ground with the gear deployed
	tailZ: -4.1,
	bodyStartZ: -3.8,
	noseStartZ: 0.6,
	noseTipZ: 4.2,
};

const BODY = { halfWidth: 0.75, bottom: 0, top: 1.2 };
const TAIL = { halfWidth: 0.62, bottom: 0.12, top: 1.05 };
const NOSE_TIP = { halfWidth: 0.18, bottom: 0.26, top: 0.5 };

// Centre of the pilot's helmet, in body space
const PILOT_HEAD = { y: BODY.top + 0.38, z: -0.15 };

// Raised fairing on top of the rear body, carrying the two top mounting pads
const SPINE = { z: -2.9, length: 1.6, halfWidth: 0.42, height: 0.06 };
const TOP_PAD_X = 0.24;

/**
 * Hardpoints: mounting positions shared by every kind of part that fits them. Each one is a mirrored pair of sockets
 * (`L` on +x, `R` on -x). Weapons and thrusters are not tied to a socket type: any hardpoint whose `accepts` lists the
 * part kind can hold it (one part per hardpoint at a time). Wing hardpoints come from the wing parts (see
 * `app/loadout.js`).
 *
 * `rear` is the exception: a single centred socket for parts that fill the whole tail. It shares the tail plate with
 * `tail`, so both list each other in `overlaps` and only one of them can be used at a time.
 */
export const HARDPOINTS = {
	nose: { label: 'Nose sides', accepts: ['weapon'], sockets: ['socket_nose_L', 'socket_nose_R'] },
	top: { label: 'Top (rear)', accepts: ['weapon', 'thruster'], sockets: ['socket_top_L', 'socket_top_R'] },
	tail: { label: 'Tail', accepts: ['thruster'], sockets: ['socket_tail_L', 'socket_tail_R'], overlaps: ['rear'] },
	rear: { label: 'Rear (centre)', accepts: ['thruster'], sockets: ['socket_rear'], overlaps: ['tail'] },
};

// Depth of the dark plate on the tail; the thruster sockets sit on its outer face
const REAR_PLATE_DEPTH = 0.05;

const GEAR_SOCKETS = [
	{ name: 'socket_gear_front', z: 2.6 },
	{ name: 'socket_gear_back', z: -2.6 },
];

/**
 * Builds the fuselage with cockpit, pilot, sockets and two landing gears (front and back).
 *
 * The origin is the ground contact point between both gears, so the fuselage can be added directly to the platform
 * mount point. `userData` exposes `pilotCameraAnchor`, `sockets` (by name), `setGearDeploy(t)`, and
 * `mountPart(socketName, part)` / `unmountPart(socketName)`, which also hide or show that socket's cover and mirror
 * parts mounted on the right side.
 */
export function buildFuselage(materials) {
	const fuselage = new THREE.Group();
	fuselage.name = 'fuselage';

	const body = new THREE.Group();
	body.name = 'body';
	body.position.y = FUSELAGE.clearance;
	fuselage.add(body);

	body.add(buildHull(materials));
	body.add(buildCockpit(materials));
	body.add(buildPilot(materials));

	const { sockets, covers } = buildSockets(materials);
	for (const socket of Object.values(sockets)) body.add(socket);
	for (const cover of covers) body.add(cover);

	const gears = GEAR_SOCKETS.map(({ name }) => {
		const socket = sockets[name];
		const gear = buildLandingGear(materials, { height: FUSELAGE.clearance + socket.position.y });
		socket.add(gear);
		return gear;
	});

	const pilotCameraAnchor = new THREE.Object3D();
	pilotCameraAnchor.name = 'pilot-camera-anchor';
	// At the pilot's eyes, inside the helmet (the near plane clips the visor)
	pilotCameraAnchor.position.set(0, PILOT_HEAD.y + 0.02, PILOT_HEAD.z + 0.07);
	// A camera looks down its -z: yaw it to face the nose, then pitch slightly down towards the dashboard
	pilotCameraAnchor.rotation.set(-0.1, Math.PI, 0, 'YXZ');
	body.add(pilotCameraAnchor);

	fuselage.userData = {
		pilotCameraAnchor,
		sockets,
		setGearDeploy: (t) => gears.forEach((gear) => gear.userData.setDeploy(t)),
		mountPart: (socketName, part) => mountPart(sockets[socketName], part),
		unmountPart: (socketName) => unmountPart(sockets[socketName]),
	};

	return fuselage;
}

/**
 * Nose section at z, linearly interpolated between the front of the body and the nose tip.
 */
function noseSection(z) {
	const t = (z - FUSELAGE.noseStartZ) / (FUSELAGE.noseTipZ - FUSELAGE.noseStartZ);
	return lerpSection(BODY, NOSE_TIP, t);
}

function lerpSection(a, b, t) {
	const lerp = THREE.MathUtils.lerp;
	return {
		halfWidth: lerp(a.halfWidth, b.halfWidth, t),
		bottom: lerp(a.bottom, b.bottom, t),
		top: lerp(a.top, b.top, t),
	};
}

function grow({ halfWidth, bottom, top }, margin) {
	return { halfWidth: halfWidth + margin, bottom: bottom - margin, top: top + margin };
}

/**
 * Box whose back face (at zBack) and front face (at zFront) have different sections. It is a `BoxGeometry` with its
 * corners moved, so every face stays planar (the sides only taper in x, the top and bottom are symmetric trapezoids)
 * and each face keeps its own vertices, giving flat normals.
 */
function taperedBox(back, front, zBack, zFront, material) {
	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const position = geometry.attributes.position;

	for (let i = 0; i < position.count; i++) {
		const isFront = position.getZ(i) > 0;
		const section = isFront ? front : back;
		position.setXYZ(
			i,
			Math.sign(position.getX(i)) * section.halfWidth,
			position.getY(i) > 0 ? section.top : section.bottom,
			isFront ? zFront : zBack
		);
	}
	geometry.computeVertexNormals();

	return new THREE.Mesh(geometry, material);
}

function box(width, height, depth, material) {
	return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function place(mesh, x, y, z) {
	mesh.position.set(x, y, z);
	return mesh;
}

/**
 * Hull: tapered tail, rectangular rear body, long wedge nose with red stripes and a sensor tip, plus dark side panels.
 */
function buildHull(materials) {
	const hull = new THREE.Group();
	hull.name = 'hull';
	const { tailZ, bodyStartZ, noseStartZ, noseTipZ } = FUSELAGE;

	hull.add(taperedBox(TAIL, BODY, tailZ, bodyStartZ, materials.hullPaint));
	hull.add(taperedBox(BODY, BODY, bodyStartZ, noseStartZ, materials.hullPaint));
	hull.add(taperedBox(BODY, NOSE_TIP, noseStartZ, noseTipZ, materials.hullPaint));

	// Nose tip: short dark wedge with a sensor probe
	const probeTip = { halfWidth: 0.06, bottom: 0.34, top: 0.42 };
	hull.add(taperedBox(NOSE_TIP, probeTip, noseTipZ, noseTipZ + 0.3, materials.hullDark));
	const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 10), materials.chrome);
	probe.rotation.x = Math.PI / 2;
	hull.add(place(probe, 0, 0.38, noseTipZ + 0.45));

	// Red squadron stripes wrapping the nose, slightly larger than the hull below them
	for (const [z0, z1] of [
		[2.2, 2.45],
		[2.65, 2.8],
	]) {
		hull.add(taperedBox(grow(noseSection(z0), 0.01), grow(noseSection(z1), 0.01), z0, z1, materials.hullRed));
	}

	// Rear plate and dark panels on the sides of the rear body
	hull.add(place(box(1.0, 0.7, REAR_PLATE_DEPTH, materials.hullDark), 0, 0.58, tailZ - REAR_PLATE_DEPTH / 2));
	for (const side of [1, -1]) {
		hull.add(place(box(0.03, 0.45, 1.4, materials.hullDark), side * (BODY.halfWidth + 0.015), 0.6, -0.9));
		hull.add(place(box(0.03, 0.12, 2.6, materials.hullRed), side * (BODY.halfWidth + 0.015), 1.0, -2.5));
	}

	// Raised fairing for the top hardpoint: painted like the hull, with red edge trims and dark grooves across
	hull.add(
		place(
			box(2 * SPINE.halfWidth, SPINE.height, SPINE.length, materials.hullPaint),
			0,
			BODY.top + SPINE.height / 2,
			SPINE.z
		)
	);
	for (const side of [1, -1]) {
		hull.add(
			place(
				box(0.04, SPINE.height + 0.01, SPINE.length, materials.hullRed),
				side * (SPINE.halfWidth - 0.02),
				BODY.top + SPINE.height / 2,
				SPINE.z
			)
		);
	}
	for (const dz of [-0.65, 0.65]) {
		hull.add(
			place(
				box(2 * SPINE.halfWidth - 0.1, 0.008, 0.03, materials.hullDark),
				0,
				BODY.top + SPINE.height,
				SPINE.z + dz
			)
		);
	}

	return hull;
}

/**
 * Faceted canopy (two glass tapered boxes), frame bars, seat and dashboard with emissive screens.
 */
function buildCockpit(materials) {
	const cockpit = new THREE.Group();
	cockpit.name = 'cockpit';

	const rearZ = -0.5;
	const midZ = FUSELAGE.noseStartZ;
	const frontZ = 1.9;
	const frontBottom = noseSection(frontZ).top;

	const rear = { halfWidth: 0.4, bottom: BODY.top, top: BODY.top + 0.52 };
	const mid = { halfWidth: 0.44, bottom: BODY.top, top: BODY.top + 0.56 };
	const front = { halfWidth: 0.1, bottom: frontBottom, top: frontBottom + 0.04 };

	cockpit.add(taperedBox(rear, mid, rearZ, midZ, materials.glass));
	cockpit.add(taperedBox(mid, front, midZ, frontZ, materials.glass));

	// Rear bulkhead and the frame hoop between both glass sections
	cockpit.add(
		place(
			box(2 * rear.halfWidth, rear.top - rear.bottom, 0.04, materials.hullDark),
			0,
			(rear.top + rear.bottom) / 2,
			rearZ
		)
	);
	const bar = 0.04;
	const hoopHeight = mid.top - mid.bottom;
	for (const side of [1, -1]) {
		cockpit.add(
			place(
				box(bar, hoopHeight, bar, materials.hullDark),
				side * mid.halfWidth,
				mid.bottom + hoopHeight / 2,
				midZ
			)
		);
	}
	cockpit.add(place(box(2 * mid.halfWidth + bar, bar, bar, materials.hullDark), 0, mid.top, midZ));

	// Seat back behind the pilot (the cushion is inside the hull, in the sunken tub)
	cockpit.add(place(box(0.46, 0.5, 0.08, materials.hullDark), 0, BODY.top + 0.25, -0.4));

	// Dashboard tilted towards the pilot, with two screens and a status light on its face
	const dashboard = place(box(0.5, 0.2, 0.1, materials.hullDark), 0, BODY.top + 0.14, 0.55);
	dashboard.rotation.x = -0.5;
	const faceZ = -0.051;
	dashboard.add(place(box(0.16, 0.1, 0.005, materials.lampCool), -0.11, 0.02, faceZ));
	dashboard.add(place(box(0.16, 0.1, 0.005, materials.lampCool), 0.11, 0.02, faceZ));
	dashboard.add(place(box(0.04, 0.03, 0.005, materials.lampWarm), 0, -0.06, faceZ));
	cockpit.add(dashboard);

	return cockpit;
}

/**
 * Seated pilot facing the nose: orange flight suit, white vest and helmet, dark visor and gloves. The pilot sits low in
 * a tub sunk into the hull (legs hidden inside), so the helmet clears the canopy. Arms are shoulder → elbow chains.
 */
function buildPilot(materials) {
	const pilot = new THREE.Group();
	pilot.name = 'pilot';
	pilot.position.set(0, BODY.top, PILOT_HEAD.z);

	const torsoHeight = 0.45;
	const torsoBottom = -0.2;
	const torsoTop = torsoBottom + torsoHeight;
	pilot.add(place(box(0.36, torsoHeight, 0.22, materials.flightSuit), 0, torsoBottom + torsoHeight / 2, 0));
	pilot.add(place(box(0.3, 0.2, 0.03, materials.hullPaint), 0, torsoTop - 0.14, 0.12));

	pilot.add(
		place(
			new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), materials.flightSuit),
			0,
			torsoTop + 0.03,
			0
		)
	);

	const headY = PILOT_HEAD.y - BODY.top;
	pilot.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), materials.hullPaint), 0, headY, 0));
	pilot.add(place(box(0.17, 0.06, 0.03, materials.hullDark), 0, headY + 0.01, 0.105));

	// A limb points down its -y; a negative rotation.x swings it forward (+z)
	const upperLength = 0.2;
	const forearmLength = 0.24;
	const armRadius = 0.045;
	for (const side of [1, -1]) {
		const shoulder = new THREE.Group();
		shoulder.position.set(side * 0.22, torsoTop - 0.05, 0);
		shoulder.rotation.x = -0.6;
		shoulder.add(limb(armRadius, upperLength, materials.flightSuit));
		pilot.add(shoulder);

		const elbow = new THREE.Group();
		elbow.position.y = -upperLength;
		elbow.rotation.x = -1.0;
		elbow.add(limb(armRadius, forearmLength, materials.flightSuit));
		shoulder.add(elbow);

		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), materials.hullDark);
		elbow.add(place(hand, 0, -forearmLength, 0));
	}

	return pilot;
}

/**
 * Cylinder hanging from its top end, so a limb rotates about its joint.
 */
function limb(radius, length, material) {
	return place(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material), 0, -length / 2, 0);
}

/**
 * Named attach points in body space: wing roots, hardpoint pairs (see `HARDPOINTS`) and gear hinges.
 *
 * Every socket keeps the ship's orientation (+z forward, +y up). Part sockets also store in `userData`:
 * - `side`: 'L', 'R' or 'C' (centre). Parts are built for the left side; `mountPart` mirrors them on the right
 *   (`scale.x = -1`). Centre parts are symmetric and never mirrored.
 * - `outward`: unit hull normal in the part's own (left-side) frame, so a builder knows which way to grow its
 *   pylon: +x on the sides, +y on top, -z at the tail.
 * - `clearance` (optional): minimum gap between the hull and the mounted part, when the default is not enough.
 * - `cover`: the plate shown while the socket is empty. It is added to the body as a sibling of the socket, so
 *   mounting a part never hides it by accident.
 */
function buildSockets(materials) {
	const sockets = {};
	const covers = [];
	const add = (name, x, y, z) => {
		const socket = new THREE.Object3D();
		socket.name = name;
		socket.position.set(x, y, z);
		sockets[name] = socket;
		return socket;
	};

	// The nose sides lean inwards towards the tip; their normal tilts towards +z by the taper slope
	const noseSlope = (BODY.halfWidth - NOSE_TIP.halfWidth) / (FUSELAGE.noseTipZ - FUSELAGE.noseStartZ);
	const noseZ = 1.6;
	const noseX = noseSection(noseZ).halfWidth;
	const rearZ = FUSELAGE.tailZ - REAR_PLATE_DEPTH;
	const topY = BODY.top + SPINE.height;

	// Left-side definitions; the right side mirrors x
	const pairs = [
		{ name: 'socket_wing', at: [BODY.halfWidth, 0.6, -2.6], outward: [1, 0, 0], cover: { size: [1.4, 0.5] } },
		{ name: 'socket_nose', at: [noseX, 0.4, noseZ], outward: [1, 0, noseSlope], cover: { size: [0.45, 0.28] } },
		{ name: 'socket_tail', at: [0.4, 0.58, rearZ], outward: [0, 0, -1], cover: { size: [0.28, 0.3] } },
		// Top parts stand on a tall pylon so they clear the canopy in front of them
		{
			name: 'socket_top',
			at: [TOP_PAD_X, topY, SPINE.z],
			outward: [0, 1, 0],
			clearance: 0.4,
			cover: { pad: 0.15 },
		},
	];

	for (const { name, at, outward, clearance, cover } of pairs) {
		for (const side of ['L', 'R']) {
			const mirror = side === 'L' ? 1 : -1;
			const socket = add(`${name}_${side}`, mirror * at[0], at[1], at[2]);
			const normal = new THREE.Vector3(...outward).normalize();
			socket.userData.side = side;
			socket.userData.outward = normal.clone();
			if (clearance) socket.userData.clearance = clearance;
			socket.userData.cover = cover.pad
				? buildPadCover(materials, socket.position, cover.pad)
				: buildCover(materials, socket.position, normal.setX(mirror * normal.x), cover.size);
			covers.push(socket.userData.cover);
		}
	}

	// Centre rear socket for parts that fill the tail. Its cover is a group holding both tail covers, so mounting there
	// hides the two hatches it sits on (a hidden parent hides its children).
	const rear = add('socket_rear', 0, 0.58, rearZ);
	rear.userData.side = 'C';
	rear.userData.outward = new THREE.Vector3(0, 0, -1);
	const rearCover = new THREE.Group();
	rearCover.name = 'rear-covers';
	for (const side of ['L', 'R']) {
		const cover = sockets[`socket_tail_${side}`].userData.cover;
		covers.splice(covers.indexOf(cover), 1);
		rearCover.add(cover);
	}
	rear.userData.cover = rearCover;
	covers.push(rearCover);

	// Gear hinges sit just inside the belly
	for (const { name, z } of GEAR_SOCKETS) {
		const bottom = z > FUSELAGE.noseStartZ ? noseSection(z).bottom : BODY.bottom;
		add(name, 0, bottom + 0.04, z);
	}

	return { sockets, covers };
}

/**
 * Cover for an unused side or tail socket, styled as a closed hull hatch so it does not read as an open mount: a
 * hull-paint panel inside a thin dark seam, with four chrome bolts. Built facing local +z, then yawed so local +z
 * matches the hull normal.
 */
function buildCover(materials, position, outward, [width, height]) {
	const cover = new THREE.Group();
	cover.name = 'socket-cover';
	cover.position.copy(position);
	cover.rotation.y = Math.atan2(outward.x, outward.z);

	const seam = 0.02;
	const seamThickness = 0.012;
	const thickness = 0.02;
	cover.add(place(box(width, height, seamThickness, materials.hullDark), 0, 0, seamThickness / 2));
	cover.add(place(box(width - 2 * seam, height - 2 * seam, thickness, materials.hullPaint), 0, 0, thickness / 2));

	const boltGeometry = new THREE.CylinderGeometry(0.016, 0.016, 0.01, 10);
	for (const sx of [1, -1]) {
		for (const sy of [1, -1]) {
			const bolt = new THREE.Mesh(boltGeometry, materials.chrome);
			bolt.rotation.x = Math.PI / 2;
			cover.add(place(bolt, sx * (width / 2 - 0.06), sy * (height / 2 - 0.06), thickness + 0.005));
		}
	}

	return cover;
}
