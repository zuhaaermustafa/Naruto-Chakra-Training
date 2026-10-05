// Before dev/build, copy WASM from the installed MediaPipe package.
// Keeping JS and WASM from the same package avoids version mismatches.
import { cp, mkdir } from 'node:fs/promises';
const source = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const destination = new URL('../public/mediapipe/wasm/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
