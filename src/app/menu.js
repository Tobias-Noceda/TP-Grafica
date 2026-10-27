import { Pane } from 'tweakpane';

import { HARDPOINTS } from '../parts/fuselage.js';
import { PART_KINDS, hardpointsFor } from './loadout.js';

/**
 * Tweakpane menu, fixed to the top-right corner. Edits `config` in place and calls `onWeaponChange()` when the weapon
 * type or its position changes.
 */
export function createMenu(config, { onWeaponChange }) {
	const pane = new Pane({ title: 'Astillero orbital' });

	const weapons = pane.addFolder({ title: 'Weapons' });
	weapons
		.addBinding(config.weapon, 'variant', { label: 'type', options: variantOptions('weapon') })
		.on('change', onWeaponChange);
	weapons
		.addBinding(config.weapon, 'hardpoint', { label: 'position', options: hardpointOptions('weapon') })
		.on('change', onWeaponChange);

	return pane;
}

// Tweakpane list options are { label: value }
function variantOptions(kind) {
	return Object.fromEntries(Object.entries(PART_KINDS[kind]).map(([id, variant]) => [variant.label, id]));
}

function hardpointOptions(kind) {
	return Object.fromEntries(hardpointsFor(kind).map((id) => [HARDPOINTS[id].label, id]));
}
