import { Pane } from 'tweakpane';

import { ALL_HARDPOINTS, PART_KINDS, hardpointsFor } from './loadout.js';

/**
 * Tweakpane menu, fixed to the top-right corner. Edits `config` in place and calls back when something changes:
 * `onWingChange()` (type or geometric params), `onWingToggle()` (open/close button), `onWeaponChange()` and
 * `onThrusterChange()`.
 */
export function createMenu(config, { onWingChange, onWingToggle, onWeaponChange, onThrusterChange }) {
	const pane = new Pane({ title: 'Astillero orbital' });

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

	const weapons = pane.addFolder({ title: 'Weapons' });
	weapons
		.addBinding(config.weapon, 'variant', { label: 'type', options: variantOptions('weapon') })
		.on('change', onWeaponChange);
	weapons
		.addBinding(config.weapon, 'hardpoint', {
			label: 'position',
			options: hardpointOptions(hardpointsFor('weapon')),
		})
		.on('change', onWeaponChange);

	// Some thrusters only fit some hardpoints, so the position list is rebuilt for each type
	const thrusters = pane.addFolder({ title: 'Thrusters' });
	let positionBinding = null;
	const showThrusterPositions = () => {
		positionBinding?.dispose();
		const ids = hardpointsFor('thruster', config.thruster.variant);
		if (!ids.includes(config.thruster.hardpoint)) config.thruster.hardpoint = ids[0];
		positionBinding = thrusters
			.addBinding(config.thruster, 'hardpoint', { label: 'position', options: hardpointOptions(ids) })
			.on('change', onThrusterChange);
	};
	thrusters
		.addBinding(config.thruster, 'variant', { label: 'type', options: variantOptions('thruster') })
		.on('change', () => {
			showThrusterPositions();
			onThrusterChange();
		});
	showThrusterPositions();

	return pane;
}

// Tweakpane list options are { label: value }
function variantOptions(kind) {
	return Object.fromEntries(Object.entries(PART_KINDS[kind]).map(([id, variant]) => [variant.label, id]));
}

function hardpointOptions(ids) {
	return Object.fromEntries(ids.map((id) => [ALL_HARDPOINTS[id].label, id]));
}
