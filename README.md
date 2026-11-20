# Astillero orbital

TP of Computación Gráfica (ITBA, 2C 2026). An interactive Three.js scene of a space hangar in orbit: configure a small
spaceship from interchangeable, procedurally generated parts, and watch an overhead crane pick each part up from the
hangar floor and mount it on the fuselage. The full brief is in `assignment.pdf`.

## Running

```sh
npm install
npm run dev        # Vite dev server on http://localhost:10001 (opens app.html)
npx vite build     # production build into dist/ (both pages)
```

| Page                                                | What it is                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`app.html`](http://localhost:10001/app.html)       | Main scene: hangar, platform, crane, automatic assembly, menu and 7 cameras.             |
| [`piezas.html`](http://localhost:10001/piezas.html) | Part viewer: every variant in a gallery, live geometric params, wireframe, normals, UVs. |

## Using the main scene

**Configure** the ship in the menu (top right): wing type and its shape parameters, weapon and thruster type and
position. In preview mode the ship rebuilds live.

**Assemble** from the menu's **Assembly** folder:

| Control                    | Effect                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Generate                   | Builds the chosen parts, lays them on the floor around the platform and starts the crane sequence. |
| Pause / Continue (`SPACE`) | Freezes or resumes the assembly (cameras keep working).                                            |
| Complete                   | Mounts every remaining part instantly.                                                             |
| Reset                      | Cancels the sequence and removes every part, ready for a new configuration.                        |
| speed                      | ×1, ×2 or ×4, changeable while it runs.                                                            |
| pieces                     | Preview only: show the parts on the ship or laid out on the floor.                                 |

The crane mounts the wings first, then the thrusters, then the weapons. For each part it moves over it, lowers the
magnet, grabs it, lifts it above the ship, carries it to the socket and slides it in. While it runs, only the View and
Assembly folders are shown.

**Keys**

| Key           | Action                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| `1`–`7`, `C`  | Select / cycle cameras                                                                 |
| `SPACE`       | Pause / continue the assembly                                                          |
| `T`           | Extend / retract the landing gear                                                      |
| `O`           | Open / close the X-wing S-foils (preview only)                                         |
| Arrows        | Drive the crane horizontally when no assembly is running (the hoist is automatic only) |
| `WASD`, Shift | Walk / run in the first-person camera (click to lock the mouse, Esc to release)        |

**Cameras**

| Key | Camera         | Notes                                                                          |
| --- | -------------- | ------------------------------------------------------------------------------ |
| 1   | Hangar orbital | Orbit the whole hangar.                                                        |
| 2   | Ship orbital   | Orbit the ship.                                                                |
| 3   | Crane orbital  | Orbit the crane magnet; follows it and the part it carries.                    |
| 4   | Pilot          | From the seat: drag to turn the head, wheel to zoom, double-click to recentre. |
| 5   | Ship chase     | Behind the ship.                                                               |
| 6   | First person   | Walk the hangar floor.                                                         |
| 7   | Crane magnet   | From the magnet face looking down; drag to look around, wheel to zoom.         |

## Required techniques

All main parts are generated at runtime from Three.js curves with our own sweep generator
(`src/geometry/sweep.js`), which writes positions, normals and UVs:

- **Surface of revolution**: weapon barrels, minigun housing, engine casing and nozzle.
- **Sweep along a curved path**: minigun ammo feed chute; plane wing panel.
- **Variable-shape sweep**: TIE wing (hull rectangle → wing outline), quad-block engine cells, plane and X-wing panels.

The exact functions are listed in the register at the top of [`DECISIONS.md`](DECISIONS.md).

## Documentation

| File                                                       | Contents                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`AGENTS.md`](AGENTS.md)                                   | Architecture, conventions, file layout and the API of every module.      |
| [`DECISIONS.md`](DECISIONS.md)                             | Technique usage register and the log of design decisions (D-001 …).      |
| [`docs/menu-libraries.md`](docs/menu-libraries.md)         | Menu library note: Tweakpane (ours) vs dat.gui (course demo), see D-013. |
| [`public/textures/CREDITS.md`](public/textures/CREDITS.md) | Texture sources and licences (Poly Haven, CC0).                          |

## Stack

[Three.js](https://threejs.org) 0.162, [Tweakpane](https://tweakpane.github.io/docs/) 4 for the menus,
[Vite](https://vite.dev) 8 as dev server and bundler. Formatting with Prettier (`.prettierrc`).
