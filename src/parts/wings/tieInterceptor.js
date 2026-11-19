import * as THREE from 'three';

import { bezierChain2 } from '../../geometry/curves.js';
import { levelMatrices } from '../../geometry/frames.js';
import { buildVariableSweepGeometry } from '../../geometry/sweep.js';
import { addTopHardpoint } from './common.js';

const defaults = { pylonLength: 1.2, span: 1.45, tipReach: 1, rearDepth: 1.1 };

/**
 * TIE Interceptor inspired wing: a neck leaves the flat hull side and flares into a dagger wing, a half-octagon at the
 * back with two mirrored triangles pointing forward. Static (does not open).
 */
export const tieInterceptor = {
	label: 'TIE Interceptor',
	opens: false,
	defaults,
	paramSchema: {
		pylonLength: { label: 'Neck length', min: 0.9, max: 1.6, step: 0.05 },
		span: { label: 'Span', min: 1.2, max: 1.6, step: 0.05 },
		tipReach: { label: 'Tip reach', min: 0.4, max: 1.5, step: 0.05 },
		rearDepth: { label: 'Rear depth', min: 0.8, max: 1.4, step: 0.05 },
	},
	build: buildTieWing,
};

// Root rectangle flush on the hull (below the red side stripe) and the slimmer neck, as half sizes in section coords
const ROOT = { halfLength: 0.8, halfHeight: 0.32 };
const NECK = { halfLength: 0.5, halfHeight: 0.2 };

// Path stations (fractions of the neck length): root fillet ends, the flare into the wing starts and ends
const FILLET_END = 0.25;
const FLARE_START = 0.84;
const FLARE_END = 0.94;

const NOTCH_X = -0.3; // notch between the two daggers, in front of the neck centre
const NOTCH_BULGE = 0.12; // the notch edges curve inwards by this much at the wing
const HARDPOINT_V = 0.55;
const PLATE_SCALE = 0.86; // red plates shrunk about their centroid, leaving the white cap as a frame
const PLATE_DEPTH = 0.015;
const STRUT = { width: 0.07, depth: 0.05 };
const HUB = { radius: 0.24, height: 0.05 };

/**
 * The whole wing is one variable-shape sweep per side along a straight path leaving the hull along +x. Its section
 * (see `sectionAt`) starts as a rectangle lying flat on the hull and ends as the full wing outline, so the shape at
 * the start and at the end of the sweep is different. The end cap is the outer face of the wing.
 *
 * Pieces along the path (split with vStart/vEnd, sections match at the boundaries):
 * - neck (white): root rectangle → slim neck rectangle (ease-out, so it leaves the hull like a fillet), then constant.
 * - flare (red): neck → wing outline, linear, so each section vertex runs along a straight line (the frame struts).
 * - rim (white): constant wing outline, the wing edge; its end cap is the outer face, with red plates on top.
 */
function buildTieWing(params, materials) {
	const { pylonLength, span, tipReach, rearDepth } = { ...defaults, ...params };

	const wing = new THREE.Group();
	wing.name = 'tie-wing';

	const path = new THREE.CubicBezierCurve3(
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(pylonLength / 3, 0, 0),
		new THREE.Vector3((2 * pylonLength) / 3, 0, 0),
		new THREE.Vector3(pylonLength, 0, 0)
	);
	const outline = wingOutline(span, tipReach, rearDepth);
	const shapeAt = (v) => sectionAt(v, outline);

	const pieces = [
		{ from: 0, to: FLARE_START, levels: 40, material: 'hullPaint' },
		{ from: FLARE_START, to: FLARE_END, levels: 8, material: 'hullRed' },
		{ from: FLARE_END, to: 1, levels: 2, material: 'hullPaint', end: true },
	];
	for (const { from, to, levels, material, end } of pieces) {
		const geometry = buildVariableSweepGeometry({
			shapeAt,
			path,
			segmentsPerCurve: 6,
			levels,
			vStart: from,
			vEnd: to,
			caps: { start: false, end: Boolean(end) },
		});
		const mesh = new THREE.Mesh(geometry, materials[material]);
		// Tagged so the part viewer can show the technique on its own (the rest are details on top of it)
		mesh.userData.technique = 'variableSweep';
		wing.add(mesh);
	}

	wing.add(buildStruts(outline, pylonLength, materials));
	wing.add(buildOuterFace(outline, pylonLength, materials));

	// Hardpoint on top of the neck, where the section is the plain neck rectangle
	const [frame] = levelMatrices(path, [HARDPOINT_V], { method: 'up' });
	const socket = addTopHardpoint(wing, new THREE.Vector3(0, NECK.halfHeight, 0).applyMatrix4(frame), materials);

	wing.userData = { sockets: { top: socket } };

	return wing;
}

/**
 * Wing outline vertices in section coordinates (x backwards, y up), counter-clockwise: notch, lower tip, bottom-rear
 * corner, rear-lower, rear-upper, top-rear corner, upper tip. The back is half an octagon; the tips point forward.
 */
function wingOutline(span, tipReach, rearDepth) {
	// Long forward daggers, like the reference: the tips reach well ahead of the neck
	const tipX = -(0.9 + 1.4 * tipReach);
	const p = (x, y) => new THREE.Vector2(x, y);
	return [
		p(NOTCH_X, 0),
		p(tipX, -span),
		p(0.45 * rearDepth, -0.72 * span),
		p(rearDepth, -0.28 * span),
		p(rearDepth, 0.28 * span),
		p(0.45 * rearDepth, 0.72 * span),
		p(tipX, span),
	];
}

/**
 * The same 7 vertices placed on a rectangle: notch → front middle, tips → front corners, top/bottom-rear corners →
 * points along the top/bottom edges, rear vertices → rear corners.
 */
function rectangleOutline({ halfLength: a, halfHeight: b }) {
	const p = (x, y) => new THREE.Vector2(x, y);
	return [p(-a, 0), p(-a, -b), p(0.3 * a, -b), p(a, -b), p(a, b), p(0.3 * a, b), p(-a, b)];
}

const ROOT_OUTLINE = rectangleOutline(ROOT);
const NECK_OUTLINE = rectangleOutline(NECK);

// Ease-out: cubic Bézier easing with control values (0, 1, 1, 1), i.e. 1 - (1 - t)³. Steep at the hull, so the root
// shrinks fast and the neck meets the hull like a fillet.
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Section at path fraction v: a closed CCW chain of 7 cubic Béziers, one per edge, always the same count so every
 * level has the same vertex count. The vertices morph root rectangle → neck rectangle → wing outline. Straight edges
 * keep their control points at 1/3 and 2/3; the two notch edges bulge inwards as the wing grows. Every vertex is a
 * knot, so the wing keeps sharp edges.
 */
function sectionAt(v, outline) {
	let vertices;
	let wingBlend = 0;
	if (v <= FILLET_END) {
		vertices = lerpOutline(ROOT_OUTLINE, NECK_OUTLINE, easeOut(v / FILLET_END));
	} else if (v <= FLARE_START) {
		vertices = NECK_OUTLINE;
	} else {
		wingBlend = Math.min(1, (v - FLARE_START) / (FLARE_END - FLARE_START));
		vertices = lerpOutline(NECK_OUTLINE, outline, wingBlend);
	}

	const points = [];
	vertices.forEach((a, i) => {
		const b = vertices[(i + 1) % vertices.length];
		const c1 = a.clone().lerp(b, 1 / 3);
		const c2 = a.clone().lerp(b, 2 / 3);
		// Edges touching the notch (last → 0 and 0 → 1): pull their control points backwards (+x)
		if (i === 0 || i === vertices.length - 1) {
			c1.x += NOTCH_BULGE * wingBlend;
			c2.x += NOTCH_BULGE * wingBlend;
		}
		points.push(a, c1, c2);
	});
	points.push(vertices[0]);

	return bezierChain2(points);
}

function lerpOutline(from, to, t) {
	return from.map((point, i) => point.clone().lerp(to[i], t));
}

/**
 * Maps section coordinates to the wing frame at distance x along the path: section x → -z, section y → +y.
 */
function toWing(point, x) {
	return new THREE.Vector3(x, point.y, -point.x);
}

/**
 * White struts on the inner (red) face: along the straight lines that the tip, top/bottom-rear and rear vertices
 * follow from the neck to the wing (the flare is linear, so these lines lie on the surface).
 */
function buildStruts(outline, pylonLength, materials) {
	const struts = new THREE.Group();
	struts.name = 'struts';

	const startX = FLARE_START * pylonLength;
	const endX = FLARE_END * pylonLength;
	for (const i of [1, 2, 3, 4, 5, 6]) {
		const start = toWing(NECK_OUTLINE[i], startX);
		const end = toWing(outline[i], endX);
		const length = start.distanceTo(end);

		const strut = new THREE.Mesh(new THREE.BoxGeometry(STRUT.width, STRUT.depth, length), materials.hullPaint);
		strut.position.lerpVectors(start, end, 0.5);
		strut.lookAt(end); // local +z along the strut (no parent yet, so local = world)
		struts.add(strut);
	}

	return struts;
}

/**
 * Outer face details on top of the white end cap: four red plates (front and rear plate on each half, split by a spoke
 * from the centre to the top/bottom-rear corner) and a white hub. The gaps between plates read as the frame.
 */
function buildOuterFace(outline, pylonLength, materials) {
	const face = new THREE.Group();
	face.name = 'outer-face';
	face.position.x = pylonLength;

	const [notch, , , , rearUpper, topRear, upperTip] = outline;
	const centre = new THREE.Vector2(0, 0);
	const rearMiddle = new THREE.Vector2(rearUpper.x, 0);

	// Upper half plates in section coordinates; the front one follows the curved notch edge
	const front = new THREE.Shape();
	const bulge = new THREE.Vector2(NOTCH_BULGE, 0);
	front.moveTo(notch.x, notch.y);
	front.bezierCurveTo(
		...notch
			.clone()
			.lerp(upperTip, 1 / 3)
			.add(bulge)
			.toArray(),
		...notch
			.clone()
			.lerp(upperTip, 2 / 3)
			.add(bulge)
			.toArray(),
		upperTip.x,
		upperTip.y
	);
	front.lineTo(topRear.x, topRear.y);
	front.lineTo(centre.x, centre.y);
	front.closePath();

	const rear = new THREE.Shape([centre, topRear, rearUpper, rearMiddle]);

	// Extrusions are along local +z; map (section x, section y, depth) to the wing frame (-z, +y, +x)
	const toFace = new THREE.Matrix4().makeBasis(
		new THREE.Vector3(0, 0, -1),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(1, 0, 0)
	);
	for (const shape of [front, rear]) {
		const geometry = new THREE.ExtrudeGeometry(shape, {
			depth: PLATE_DEPTH,
			bevelEnabled: false,
			curveSegments: 8,
		});
		geometry.computeBoundingBox();
		const centroid = geometry.boundingBox.getCenter(new THREE.Vector3()).setZ(0);
		geometry.translate(-centroid.x, -centroid.y, 0);
		geometry.scale(PLATE_SCALE, PLATE_SCALE, 1);
		geometry.translate(centroid.x, centroid.y, 0.002);
		geometry.applyMatrix4(toFace);

		face.add(new THREE.Mesh(geometry, materials.hullRed));
		// Lower half: the same plate mirrored in y
		const lower = new THREE.Mesh(geometry, materials.hullRed);
		lower.scale.y = -1;
		face.add(lower);
	}

	const hub = new THREE.Mesh(new THREE.CylinderGeometry(HUB.radius, HUB.radius, HUB.height, 24), materials.hullPaint);
	hub.rotation.z = -Math.PI / 2;
	hub.position.x = HUB.height / 2;
	face.add(hub);

	return face;
}
