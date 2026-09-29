import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  root,
  "node_modules",
  "@vladmandic",
  "face-api",
  "model",
);
const destination = path.join(root, "public", "face-models");
const files = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_tiny_model-weights_manifest.json",
  "face_landmark_68_tiny_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

await mkdir(destination, { recursive: true });
await Promise.all(
  files.map((file) =>
    copyFile(path.join(source, file), path.join(destination, file)),
  ),
);
console.log(`Face ID modellari tayyorlandi: ${destination}`);
