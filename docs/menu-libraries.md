# Menu libraries: Tweakpane (TP) vs dat.gui (course demo)

Reference note comparing this project's menu (`src/app/menu.js`) with the one in the course demo
`gITBA/electivas/grafica/demos-templates/demoExcavadora` (`src/main.js`, `createMenu`). The decision itself is
D-013 in `DECISIONS.md`.

**Summary:** both are the same idea, a panel bound to a plain object. They differ in library and in how the scene
reacts to changes. For this assignment they are about equally capable. Tweakpane offers a bit more and is maintained.

## Library

|              | Demo (excavadora)                                             | TP (`src/app/menu.js`)               |
| ------------ | ------------------------------------------------------------- | ------------------------------------ |
| Library      | `dat.gui` 0.7.9                                               | `tweakpane` 4.0.5                    |
| Maintained   | No (last release 2020); `lil-gui` is its maintained successor | Yes                                  |
| Placement    | Fixed top-right, `width: 400`                                 | Fixed top-right, default width       |
| Organisation | Flat list of 6 controls (camera + excavator angles)           | Folders (`Weapons` → type, position) |

## Usage

Both bind controls to fields of a plain object; moving a control writes the field directly.

```js
// demo (dat.gui): an array becomes a dropdown, (min, max) a slider
gui.add(params, 'camaraActual', ['general', 'vehiculo', 'conductor']);
gui.add(params, 'anguloBrazo', 0, 90).step(0.001);

// TP (Tweakpane): options are { label: value }, plus a change event
weapons
	.addBinding(config.weapon, 'hardpoint', {
		label: 'position',
		options: { 'Nose sides': 'nose', 'Top (rear)': 'top' },
	})
	.on('change', onWeaponChange);
```

The real difference is **how the scene reacts**:

- **Demo, polling:** `animate()` reads `params` every frame and applies the angles via `sceneManager.animate(params)`.
  It needs no callbacks, because setting a rotation is cheap.
- **TP, events:** a change fires `onWeaponChange`, which rebuilds the parts and disposes the old geometry
  (`src/app/loadout.js`). Rebuilding every frame would be wasteful, so this must stay event-driven. Wing parameters
  will follow the same pattern.

**Gotcha (both libraries):** when code changes a bound value, the panel does not redraw by itself. In the demo,
the `C` key changes `params.camaraActual`, but dat.gui only shows it with `.listen()`. In Tweakpane, call
`pane.refresh()`. This matters once the TP's camera keys (`1`–`6`, `C`) or the assembly update menu values.

## Capability

Everything the TP needs exists in both: sliders, dropdowns, checkboxes, buttons (generate, pause, complete, reset)
and folders. Tweakpane adds the following:

- monitors and live graphs (an FPS readout, or the current assembly state);
- tabs and separators;
- 2D and 3D point inputs, which would suit editing curve control points;
- an essentials plugin (FPS meter, interval sliders);
- typed bindings and a more polished look.

dat.gui is slightly terser, and it is what the course demos use.

## Recommendation

Keep Tweakpane: it is maintained, AGENTS.md names it, the brief allows it, and its monitors will help with the assembly
state machine. To match the course demos instead, use `lil-gui`, whose API is nearly the same as dat.gui and which is
maintained. Switching only rewrites `src/app/menu.js`, because `config` and the callbacks stay the same.
