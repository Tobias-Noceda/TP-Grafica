import * as THREE from 'three';

import { bezierChain2 } from '../../geometry/curves.js';
import { levelMatrices } from '../../geometry/frames.js';
import { buildVariableSweepGeometry } from '../../geometry/sweep.js';
import { addTopHardpoint } from './common.js';

const defaults = { pylonLength: 2.3, span: 1.45, tipReach: 2.25, rearDepth: 1.1 };

/**
 * TIE Interceptor inspired wing: a neck leaves the flat hull side and flares into a dagger wing, a half-octagon at the
 * back whose top/bottom edges run forward into two mirrored daggers pointing forward. Static (does not open).
 * Reference: https://www.starwars.com/databank/tie-interceptor
 */
export const tieInterceptor = {
	label: 'TIE Interceptor',
	opens: false,
	defaults,
	paramSchema: {
		pylonLength: { label: 'Neck length', min: 1.8, max: 2.8, step: 0.05 },
		span: { label: 'Span', min: 1.2, max: 1.6, step: 0.05 },
		tipReach: { label: 'Tip reach', min: 1.5, max: 3.0, step: 0.05 },
		rearDepth: { label: 'Rear depth', min: 0.8, max: 1.4, step: 0.05 },
	},
	build: buildTieWing,
};

// Root rectangle flush on the hull (below the red side stripe) and the slimmer neck, as half sizes in section coords
const ROOT = { halfLength: 0.8, halfHeight: 0.32 };
const NECK = { halfLength: 0.2, halfHeight: 0.2 };

// Path stations (fractions of the neck length): root fillet ends, the flare into the wing starts and ends
const FILLET_END = 0.25;
const FLARE_START = 0.84;
const FLARE_END = 0.94;

const NOTCH_X = -0.3; // notch between the two daggers, in front of the neck centre
const NOTCH_BULGE = 0.12; // the notch edges curve inwards by this much at the wing
const HARDPOINT_V = 0.45;
const PLATE_SCALE = 0.86; // red plates shrunk about their centroid, leaving the white cap as a frame
const PLATE_DEPTH = 0.015;
const STRUT = { width: 0.07, depth: 0.05 };
const HUB = { radius: 0.24, height: 0.05 };
const SUPPORT_V = 0.5; // floor jig station: middle of the straight neck, clear of the wing's floor pads
const FLANGE = { margin: 0.05, thickness: 0.03 }; // dark mounting flange around the root rectangle

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
		{ from: 0, to: FLARE_START, levels: 40, material: 'hullPaint', start: true },
		{ from: FLARE_START, to: FLARE_END, levels: 8, material: 'hullRed' },
		{ from: FLARE_END, to: 1, levels: 2, material: 'hullPaint', end: true },
	];
	for (const { from, to, levels, material, start, end } of pieces) {
		const geometry = buildVariableSweepGeometry({
			shapeAt,
			path,
			segmentsPerCurve: 6,
			levels,
			vStart: from,
			vEnd: to,
			// The start cap closes the root, so the wing is not hollow when it is off the hull
			caps: { start: Boolean(start), end: Boolean(end) },
		});
		const mesh = new THREE.Mesh(geometry, materials[material]);
		// Tagged so the part viewer can show the technique on its own (the rest are details on top of it)
		mesh.userData.technique = 'variableSweep';
		wing.add(mesh);
	}

	wing.add(buildRootFlange(materials));
	wing.add(buildStruts(outline, pylonLength, materials));
	wing.add(buildOuterFace(outline, pylonLength, materials));

	// Hardpoint on top of the neck, where the section is the plain neck rectangle
	const [frame] = levelMatrices(path, [HARDPOINT_V], { method: 'up' });
	const socket = addTopHardpoint(wing, new THREE.Vector3(0, NECK.halfHeight, 0).applyMatrix4(frame), materials);

	// Where a floor jig holds the wing level while it waits for the crane: under the straight neck
	const support = {
		point: new THREE.Vector3(SUPPORT_V * pylonLength, -NECK.halfHeight, 0),
		halfWidth: NECK.halfLength,
	};

	wing.userData = { sockets: { top: socket }, support };

	return wing;
}

/**
 * Dark mounting flange on the root face: a thin plate slightly larger than the root rectangle, on the hull side.
 */
function buildRootFlange(materials) {
	const { margin, thickness } = FLANGE;
	const geometry = new THREE.BoxGeometry(thickness, 2 * (ROOT.halfHeight + margin), 2 * (ROOT.halfLength + margin));
	const flange = new THREE.Mesh(geometry, materials.hullDark);
	flange.name = 'root-flange';
	flange.position.x = thickness / 2;
	return flange;
}

// Outline vertex indices (counter-clockwise). Every outline (root, neck, wing) uses this order and count.
const V = {
	notch: 0,
	lowerInner: 1,
	lowerTip: 2,
	lowerShoulder: 3,
	bottomRear: 4,
	rearLower: 5,
	rearUpper: 6,
	topRear: 7,
	upperShoulder: 8,
	upperTip: 9,
	upperInner: 10,
};

// Wing outline proportions, as fractions of the span (y) or of the tip x (shoulder)
const REAR_HALF_HEIGHT = 0.4; // half height of the vertical rear edge
const TIP_HEIGHT = 0.4; // the tips sit near the centre line, well inside the top/bottom edges
const SHOULDER_REACH = 0.35; // where the top/bottom edge stops and the dagger edge starts, towards the tip

/**
 * Wing outline vertices in section coordinates (x backwards, y up), counter-clockwise (see `V`). The back is half an
 * octagon whose top and bottom edges carry on forward to a shoulder; from there the dagger edge narrows to a tip
 * near the centre line, pointing forward. The inner points sit at the tip height and the same distance ahead of the
 * socket (x = -tip height), so the dagger's inner edge runs straight from them to the tip before the notch.
 */
function wingOutline(span, tipReach, rearDepth) {
	// Long forward daggers, like the reference: the tips reach well ahead of the neck
	const tipX = -(0.9 + 1.4 * tipReach);
	const tipY = TIP_HEIGHT * span;
	const shoulderX = SHOULDER_REACH * tipX;
	const p = (x, y) => new THREE.Vector2(x, y);
	return [
		p(NOTCH_X, 0),
		p(-tipY, -tipY),
		p(tipX, -tipY),
		p(shoulderX, -span),
		p(0.45 * rearDepth, -span),
		p(rearDepth, -REAR_HALF_HEIGHT * span),
		p(rearDepth, REAR_HALF_HEIGHT * span),
		p(0.45 * rearDepth, span),
		p(shoulderX, span),
		p(tipX, tipY),
		p(-tipY, tipY),
	];
}

/**
 * The same 11 vertices placed on a rectangle: notch → front middle, inner points → halfway along the front edge,
 * tips → front corners, shoulders and top/bottom-rear corners → points along the top/bottom edges, rear vertices →
 * rear corners.
 */
function rectangleOutline({ halfLength: a, halfHeight: b }) {
	const p = (x, y) => new THREE.Vector2(x, y);
	return [
		p(-a, 0),
		p(-a, -0.5 * b),
		p(-a, -b),
		p(-0.35 * a, -b),
		p(0.3 * a, -b),
		p(a, -b),
		p(a, b),
		p(0.3 * a, b),
		p(-0.35 * a, b),
		p(-a, b),
		p(-a, 0.5 * b),
	];
}

const ROOT_OUTLINE = rectangleOutline(ROOT);
const NECK_OUTLINE = rectangleOutline(NECK);

// Ease-out: cubic Bézier easing with control values (0, 1, 1, 1), i.e. 1 - (1 - t)³. Steep at the hull, so the root
// shrinks fast and the neck meets the hull like a fillet.
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Section at path fraction v: a closed CCW chain of 11 cubic Béziers, one per edge, always the same count so every
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

/** Vertex-by-vertex blend of two outlines with the same vertex count. */
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
 * White struts on the inner (red) face: along the straight lines that every outline vertex but the notch
 * follow from the neck to the wing (the flare is linear, so these lines lie on the surface).
 */
function buildStruts(outline, pylonLength, materials) {
	const struts = new THREE.Group();
	struts.name = 'struts';

	const startX = FLARE_START * pylonLength;
	const endX = FLARE_END * pylonLength;
	for (let i = V.lowerInner; i <= V.upperInner; i++) {
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

	const notch = outline[V.notch];
	const rearUpper = outline[V.rearUpper];
	const topRear = outline[V.topRear];
	const upperShoulder = outline[V.upperShoulder];
	const upperTip = outline[V.upperTip];
	const upperInner = outline[V.upperInner];
	const centre = new THREE.Vector2(0, 0);
	const rearMiddle = new THREE.Vector2(rearUpper.x, 0);

	// Upper half plates in section coordinates; the front one follows the curved notch edge
	const front = new THREE.Shape();
	const bulge = new THREE.Vector2(NOTCH_BULGE, 0);
	front.moveTo(notch.x, notch.y);
	front.bezierCurveTo(
		...notch
			.clone()
			.lerp(upperInner, 1 / 3)
			.add(bulge)
			.toArray(),
		...notch
			.clone()
			.lerp(upperInner, 2 / 3)
			.add(bulge)
			.toArray(),
		upperInner.x,
		upperInner.y
	);
	front.lineTo(upperTip.x, upperTip.y);
	front.lineTo(upperShoulder.x, upperShoulder.y);
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
