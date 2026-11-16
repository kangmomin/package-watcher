import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const noGh = (): string | null => null;

describe("[SH-80] GITHUB_API_URL", () => {
  it("없으면 null 이다 (octokit 의 기본 주소를 쓴다)", () => {
    expect(loadConfig({}, noGh).githubApiUrl).toBeNull();
    expect(loadConfig({ GITHUB_API_URL: "  " }, noGh).githubApiUrl).toBeNull();
  });

  it("http·https 주소를 받고 끝의 / 는 뗀다", () => {
    expect(loadConfig({ GITHUB_API_URL: "http://localhost:3200/" }, noGh).githubApiUrl).toBe("http://localhost:3200");
    expect(loadConfig({ GITHUB_API_URL: "https://ghe.example.com/api/v3" }, noGh).githubApiUrl).toBe(
      "https://ghe.example.com/api/v3",
    );
  });

  it("형식이 틀리면 시작을 막는다 (조용히 실제 GitHub 으로 가지 않는다)", () => {
    expect(() => loadConfig({ GITHUB_API_URL: "localhost:3200" }, noGh)).toThrow(/GITHUB_API_URL/);
    expect(() => loadConfig({ GITHUB_API_URL: "ftp://x" }, noGh)).toThrow(/GITHUB_API_URL/);
    expect(() => loadConfig({ GITHUB_API_URL: "not a url" }, noGh)).toThrow(/GITHUB_API_URL/);
  });
});
