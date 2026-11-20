import { Pane } from 'tweakpane';

import { ALL_HARDPOINTS, PART_KINDS, hardpointsFor } from './loadout.js';

/**
 * Tweakpane menu, fixed to the top-right corner. Edits `config` in place and calls back when something changes:
 * `onWingChange()` (type or geometric params), `onWingToggle()` (open/close button), `onWeaponChange()` and
 * `onThrusterChange()`. The assembly folder edits `config.assembly.layout` ('ship' | 'floor') and calls
 * `onLayoutChange(value)`. The view folder edits `config.view`: `onCameraChange(index)` (options from `cameraOptions`,
 * `{ label: index }`) and `onShadowsChange(level)`. The assembly folder also has Generate / Pause / Complete / Reset
 * buttons (`onGenerate`, `onTogglePause`, `onComplete`, `onReset`), a `config.assembly.speed` list and a status monitor.
 * Returns `{ pane, refresh(), setMode({ mode, paused }) }`: call `refresh()` after changing `config.view.camera` from
 * the keyboard, and `setMode` when the app mode ('preview' | 'assembling' | 'empty') or the pause state changes.
 */
export function createMenu(
	config,
	{
		onWingChange,
		onWingToggle,
		onLayoutChange,
		onGenerate,
		onTogglePause,
		onComplete,
		onReset,
		onWeaponChange,
		onThrusterChange,
		cameraOptions,
		onCameraChange,
		onShadowsChange,
	}
) {
	const pane = new Pane({ title: 'Astillero orbital' });

	const view = pane.addFolder({ title: 'View' });
	view.addBinding(config.view, 'camera', { label: 'camera (1-7, C)', options: cameraOptions }).on('change', (event) =>
		onCameraChange(event.value)
	);
	view.addBinding(config.view, 'shadows', {
		options: { Off: 'off', Low: 'low', High: 'high' },
	}).on('change', (event) => onShadowsChange(event.value));

	const assembly = pane.addFolder({ title: 'Assembly' });
	assembly.addButton({ title: 'Generate' }).on('click', () => onGenerate());
	const pauseButton = assembly.addButton({ title: 'Pause (SPACE)' });
	pauseButton.on('click', () => onTogglePause());
	const completeButton = assembly.addButton({ title: 'Complete' });
	completeButton.on('click', () => onComplete());
	assembly.addButton({ title: 'Reset' }).on('click', () => onReset());
	assembly.addBinding(config.assembly, 'speed', { label: 'speed', options: { x1: 1, x2: 2, x4: 4 } });
	assembly.addBinding(config.assembly, 'status', { label: 'status', readonly: true, interval: 200 });
	const layoutBinding = assembly
		.addBinding(config.assembly, 'layout', {
			label: 'pieces',
			options: { 'On the ship': 'ship', 'On the floor': 'floor' },
		})
		.on('change', (event) => onLayoutChange(event.value));

	const wings = pane.addFolder({ title: 'Wings' });
	wings.addBinding(config.wing, 'variant', { label: 'type', options: variantOptions('wing') }).on('change', () => {
		// A new variant starts from its own defaults and shows its own params
		config.wing.params = { ...PART_KINDS.wing[config.wing.variant].defaults };
		showWingParams();
		onWingChange();
	});
	const toggleButton = wings.addButton({ title: 'Open / close (O)' });
	toggleButton.on('click', onWingToggle);

	// Geometric params rebuild the wing geometry, so they come from the variant's `paramSchema`
	let paramsFolder = null;
	const showWingParams = () => {
		paramsFolder?.dispose();
		const variant = PART_KINDS.wing[config.wing.variant];
		paramsFolder = wings.addFolder({ title: 'Shape' });
		for (const [key, { label, min, max, step }] of Object.entries(variant.paramSchema)) {
			paramsFolder.addBinding(config.wing.params, key, { label, min, max, step }).on('change', onWingChange);
		}
		toggleButton.hidden = !variant.opens;
	};
	showWingParams();

	// Weapons and thrusters share the hardpoints: each position list leaves out the ones the other kind is using
	const entries = { weapon: config.weapon, thruster: config.thruster };
	const folders = {};
	const onPositionChange = (kind, onChange) => () => {
		onChange();
		for (const other of Object.keys(folders)) if (other !== kind) folders[other].refresh();
	};
	folders.weapon = partFolder(pane, 'Weapons', 'weapon', entries, onPositionChange('weapon', onWeaponChange));
	folders.thruster = partFolder(
		pane,
		'Thrusters',
		'thruster',
		entries,
		onPositionChange('thruster', onThrusterChange)
	);
	Object.values(folders).forEach((folder) => folder.refresh());

	return {
		pane,
		refresh: () => pane.refresh(),
		setMode({ mode, paused }) {
			const assembling = mode === 'assembling';
			// While the crane assembles, only the View and Assembly folders are shown: no ship building options
			for (const folder of [wings, folders.weapon.folder, folders.thruster.folder]) folder.hidden = assembling;
			layoutBinding.hidden = mode !== 'preview';
			pauseButton.disabled = completeButton.disabled = !assembling;
			pauseButton.title = paused ? 'Continue (SPACE)' : 'Pause (SPACE)';
		},
	};
}

/**
 * Hardpoints taken by the other part kinds, with the ones they overlap (e.g. `tail` and `rear` share the tail plate).
 */
function takenHardpoints(kind, entries) {
	const taken = new Set();
	for (const [other, { hardpoint }] of Object.entries(entries)) {
		if (other === kind || !hardpoint) continue;
		taken.add(hardpoint);
		for (const id of ALL_HARDPOINTS[hardpoint].overlaps ?? []) taken.add(id);
	}
	return taken;
}

/**
 * Folder with a type list and a position list for one part kind. The positions are the hardpoints the chosen variant
 * allows (`hardpointsFor`) that no other kind is using; when the current position is not among them, it moves to the
 * first one. `refresh()` rebuilds the list after the other kinds move.
 */
function partFolder(pane, title, kind, entries, onChange) {
	const entry = entries[kind];
	const folder = pane.addFolder({ title });
	let positionBinding = null;
	const showPositions = () => {
		positionBinding?.dispose();
		const taken = takenHardpoints(kind, entries);
		const ids = hardpointsFor(kind, entry.variant).filter((id) => !taken.has(id));
		const moved = ids.length > 0 && !ids.includes(entry.hardpoint);
		if (moved) entry.hardpoint = ids[0];
		positionBinding = folder
			.addBinding(entry, 'hardpoint', { label: 'position', options: hardpointOptions(ids) })
			.on('change', onChange);
		return moved;
	};
	folder.addBinding(entry, 'variant', { label: 'type', options: variantOptions(kind) }).on('change', () => {
		showPositions();
		onChange();
	});
	return {
		folder,
		refresh() {
			if (showPositions()) onChange();
		},
	};
}

// Tweakpane list options are { label: value }
function variantOptions(kind) {
	return Object.fromEntries(Object.entries(PART_KINDS[kind]).map(([id, variant]) => [variant.label, id]));
}

function hardpointOptions(ids) {
	return Object.fromEntries(ids.map((id) => [ALL_HARDPOINTS[id].label, id]));
}
