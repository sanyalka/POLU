import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  process.exit(0);
}

const packageByArch = {
  x64: "@rollup/rollup-win32-x64-msvc",
  ia32: "@rollup/rollup-win32-ia32-msvc",
  arm64: "@rollup/rollup-win32-arm64-msvc"
};

const nativePackage = packageByArch[process.arch];
if (!nativePackage) {
  process.exit(0);
}

try {
  await import(nativePackage);
  process.exit(0);
} catch {
  // Missing optional dependency because of npm optional-deps bug.
}

const result = spawnSync("npm", ["install", "--no-save", `${nativePackage}@4.60.2`], {
  stdio: "inherit",
  shell: true
});

if (result.status !== 0) {
  console.error(`Failed to install ${nativePackage}. Try: npm install --include=optional`);
  process.exit(result.status ?? 1);
}
