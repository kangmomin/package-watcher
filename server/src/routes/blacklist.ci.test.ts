import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bulkRequest, csvFile, exportRequest, importOk } from "../test/bulk.ts";
import { cleanupTestApps, createTestApp, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

describe("새 종류(actions, docker)의 가져오기·내보내기·일괄·필터", () => {
  it("[SB-62] CSV 로 가져오면 이름을 정규화해서 저장하고 잘못된 범위는 행 오류로 알린다", async () => {
    const content = csvFile([
      ["actions", "Aquasecurity/Trivy-Action", '"v0.34.0, v0.34.1"', "high", "변조", "true", ""],
      ["docker", "docker.io/library/Node", `"20, sha256:${"a".repeat(64)}"`, "low", "x", "true", ""],
    ]);
    const invalid = csvFile([["docker", "bad", "a;b", "low", "x", "true", ""]]);

    expect((await importOk(t, "csv", invalid, true)).errors).toHaveLength(1);
    const result = await importOk(t, "csv", content, false);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(2);
    const entries = await listEntries(t);
    expect(entries.map((e) => `${e.ecosystem}:${e.name}`).sort()).toEqual([
      "actions:aquasecurity/trivy-action",
      "docker:node",
    ]);
  });

  it("[SB-63] 내보낸 파일을 다시 가져오면 변경이 없고, 일괄 끄기·ecosystem 필터가 동작한다", async () => {
    const a = await addEntry(t, { ecosystem: "actions", name: "evil/act", versionRange: "v1", reason: "x" });
    const b = await addEntry(t, { ecosystem: "docker", name: "evil/img", versionRange: "1.0", reason: "x" });

    const exported = await exportRequest(t, { format: "csv" });
    expect(exported.status, exported.text).toBe(200);
    expect((await importOk(t, "csv", exported.text, true)).unchanged).toBe(2);

    expect((await listEntries(t, { ecosystem: "actions" })).map((e) => e.id)).toEqual([a.id]);
    expect((await listEntries(t, { ecosystem: "docker" })).map((e) => e.id)).toEqual([b.id]);
    const res = await bulkRequest(t, "disable", [a.id, b.id]);
    expect(res.status, res.text).toBe(200);
    expect((await listEntries(t, { enabled: "false" })).map((e) => e.id).sort()).toEqual([a.id, b.id]);
  });
});
