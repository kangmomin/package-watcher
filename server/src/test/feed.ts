import type { FeedKind } from "@pw/shared";
import type { FeedClient, FeedPage } from "../feed/client.ts";

export interface FakeNodeInput {
  ghsa: string;
  /** GitHub 의 종류 이름 (기본 NPM) */
  ecosystem?: string;
  name: string;
  /** GitHub 의 범위 표기 (기본 `>= 0`) */
  range?: string;
  /** 기본 CRITICAL */
  severity?: string;
  summary?: string;
  /** 노드의 갱신 시각 (기본 2026-11-01T00:00:00Z) */
  updatedAt?: string;
  withdrawnAt?: string | null;
  /** cve 의 쿼리가 주는 필드 */
  cvssV3?: number | null;
  cvssV4?: number | null;
  patched?: string | null;
}

export function fakeNode(input: FakeNodeInput): Record<string, unknown> {
  return {
    updatedAt: input.updatedAt ?? "2026-11-01T00:00:00Z",
    vulnerableVersionRange: input.range ?? ">= 0",
    package: { ecosystem: input.ecosystem ?? "NPM", name: input.name },
    advisory: {
      ghsaId: input.ghsa,
      summary: input.summary ?? `Malware in ${input.name}`,
      severity: input.severity ?? "CRITICAL",
      permalink: `https://github.com/advisories/${input.ghsa}`,
      withdrawnAt: input.withdrawnAt ?? null,
      updatedAt: input.updatedAt ?? "2026-11-01T00:00:00Z",
      cvssSeverities: { cvssV3: { score: input.cvssV3 ?? null }, cvssV4: { score: input.cvssV4 ?? null } },
    },
    firstPatchedVersion: input.patched === undefined || input.patched === null ? null : { identifier: input.patched },
  };
}

type Gate = { reached: Promise<void>; release: () => void };

/**
 * 메모리 위의 가짜 GraphQL. 노드를 `updatedAt` 내림차순으로 정렬해서 `pageSize` 씩 준다.
 * cursor 는 "다음 시작 위치"의 문자열이다. `calls`(malware)·`cveCalls`(cve)에 받은 cursor 를 기록한다.
 * 노드는 분류마다 따로 둔다(`setNodes(nodes, kind)`). cve 의 노드를 주지 않으면 cve 는 빈 목록이다.
 */
export class FakeFeedClient implements FeedClient {
  readonly calls: (string | null)[] = [];
  readonly cveCalls: (string | null)[] = [];
  /** n번째 호출(1부터)을 이 오류로 실패시킨다 */
  readonly failures = new Map<number, Error>();
  /** cve 의 n번째 호출(1부터)을 이 오류로 실패시킨다 */
  readonly cveFailures = new Map<number, Error>();
  private nodes: unknown[] = [];
  private cveNodes: unknown[] = [];
  private gate: (Gate & { used: boolean; arrive: () => void }) | null = null;

  constructor(
    nodes: unknown[] = [],
    private pageSize = 100,
  ) {
    this.setNodes(nodes);
  }

  setNodes(nodes: unknown[], kind: FeedKind = "malware"): void {
    // 정렬은 안정적이다(같은 시각이면 입력 순서)
    const time = (node: unknown): number => Date.parse(String((node as { updatedAt?: unknown } | null)?.updatedAt)) || 0;
    const sorted = [...nodes].sort((a, b) => time(b) - time(a));
    if (kind === "cve") this.cveNodes = sorted;
    else this.nodes = sorted;
  }

  setPageSize(size: number): void {
    this.pageSize = size;
  }

  /** 다음 호출을 멈춰 둔다(1회용). `release()` 로 푼다. */
  pauseNext(): Gate {
    let arrive: () => void = () => undefined;
    let release: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => (arrive = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    this.gate = { reached, release, used: false, arrive };
    this.released = released;
    return { reached, release };
  }

  /** 남은 gate 를 연다 (정리용) */
  releaseAll(): void {
    this.gate?.release();
  }

  private released: Promise<void> | null = null;

  async fetchPage(kind: FeedKind, cursor: string | null): Promise<FeedPage> {
    const cve = kind === "cve";
    const calls = cve ? this.cveCalls : this.calls;
    calls.push(cursor);
    // 멈춤(gate)은 malware 의 호출에만 건다
    const gate = cve ? null : this.gate;
    if (gate && !gate.used) {
      gate.used = true;
      gate.arrive();
      await this.released;
    }
    const failure = (cve ? this.cveFailures : this.failures).get(calls.length);
    if (failure) throw failure;
    const all = cve ? this.cveNodes : this.nodes;
    const start = cursor === null ? 0 : Number(cursor);
    const nodes = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { nodes, nextCursor: next < all.length ? String(next) : null };
  }
}
