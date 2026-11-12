import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // @pw/shared 는 빌드 없는 소스 패키지라서 번들에 넣는다. 네이티브 모듈은 밖에 둔다.
  noExternal: ["@pw/shared"],
  external: ["better-sqlite3"],
});
