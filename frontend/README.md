# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Race replay

RACE → Replay plays back real recorded positions of completed races. **Position data: OpenF1 (CC BY-NC-SA 4.0). Replay is interpolated from ~3.8 Hz samples and is not official timing.**
The page is optional: it reads files from `VITE_REPLAY_BASE_URL` (a public storage bucket; in `npm run dev` it falls back to the untracked `public/replay-dev/` folder) and shows "Replay not available" when they are absent.
How to generate and host the files: [docs/replay/README.md](../docs/replay/README.md).
