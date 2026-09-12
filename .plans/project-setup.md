# Project setup: scaffold the Canvas game with Vite + TypeScript

## Context

CLAUDE.md now records the decisions to build a Canvas-based game in TypeScript, bundled with
Vite, with a modular architecture, and to keep implementation plans under `.plans/`. The
project directory is currently empty (aside from `.git` and `CLAUDE.md`). This plan scaffolds
the actual project so that decision is reflected in a working, buildable skeleton — no game
logic yet, just the structure and tooling.

## Approach

1. **Scaffold with Vite's `vanilla-ts` template**, generated directly into the project root
   (not a nested subfolder), via:
   ```
   npm create vite@latest . -- --template vanilla-ts
   ```
   This gives `package.json`, `tsconfig.json`, `index.html`, `vite.config.ts` (if needed),
   and a `src/` folder with Vite's default TS entry files.

2. **Replace the default template content** with a Canvas-ready entry point:
   - `index.html`: single `<canvas id="game">` element instead of Vite's default markup.
   - `src/main.ts`: bootstraps the canvas context and starts the game loop (calls into
     `core/`), replacing Vite's default counter demo code.
   - Delete Vite's default `src/style.css`/`counter.ts`/`typescript.svg` demo files — they're
     template cruft unrelated to a Canvas game.

3. **Create the modular `src/` folder structure**, one `index.ts` per folder as a placeholder
   entry point so the module boundary exists from commit one:
   - `src/core/` — game loop (fixed/variable timestep update+render cycle), central engine
     wiring the other modules together.
   - `src/rendering/` — Canvas drawing helpers, wraps `CanvasRenderingContext2D` so game code
     never touches the raw context directly.
   - `src/input/` — keyboard/mouse/touch handling, exposes a polling or event-based API to
     `core`.
   - `src/entities/` — game object definitions/types (base entity interface, initially empty
     of concrete entities).
   - `src/state/` — game/app state management (e.g. current scene, score, game-over flags).

   Each module folder exports through its own `index.ts` (barrel file) so other modules import
   `from '../rendering'` rather than reaching into internal files — this is the enforced module
   boundary per CLAUDE.md's "Modular design" principle.

4. **Set up ESLint + Prettier for TypeScript**:
   - `eslint.config.js` (flat config) using `typescript-eslint`.
   - `.prettierrc` with sensible defaults (semi, single quotes — confirm no strong preference,
     otherwise use common TS conventions).
   - `eslint-config-prettier` to disable stylistic ESLint rules that conflict with Prettier.
   - Add `lint` and `format` scripts to `package.json`.

5. **Verify `.gitignore` covers `node_modules`, `dist`, and editor/OS cruft** (Vite's
   scaffold includes a reasonable default — confirm it's present and adequate rather than
   rewriting it).

6. **Create the `.plans/` folder** (per CLAUDE.md) and move this plan's *finished* copy into
   `.plans/project-setup.md` once implementation is complete, so the convention is live
   starting with this very plan.

## Files to be created/modified

- `package.json`, `tsconfig.json`, `vite.config.ts` — via Vite scaffold, then edited for lint scripts.
- `index.html` — replace demo markup with `<canvas>`.
- `src/main.ts` — replace demo logic with canvas bootstrap + core game loop kickoff.
- `src/core/index.ts`, `src/rendering/index.ts`, `src/input/index.ts`, `src/entities/index.ts`, `src/state/index.ts` — new placeholder modules.
- `eslint.config.js`, `.prettierrc` — new lint/format config.
- `.plans/project-setup.md` — copy of this plan, per the CLAUDE.md convention.
- Remove: Vite's default `src/style.css`, `src/counter.ts`, `src/typescript.svg`, `public/vite.svg` (demo assets).

## Verification

- `npm install` completes without errors.
- `npm run dev` starts the Vite dev server and the browser shows a blank canvas (confirms
  Canvas + TS + Vite wiring works end-to-end).
- `npm run build` produces a `dist/` bundle without TypeScript errors.
- `npm run lint` runs ESLint clean against the placeholder module files.
