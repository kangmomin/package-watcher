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
    },
  };
}

type Gate = { reached: Promise<void>; release: () => void };

/**
 * 메모리 위의 가짜 GraphQL. 노드를 `updatedAt` 내림차순으로 정렬해서 `pageSize` 씩 준다.
 * cursor 는 "다음 시작 위치"의 문자열이다. `calls` 에 받은 cursor 를 기록한다.
 */
export class FakeFeedClient implements FeedClient {
  readonly calls: (string | null)[] = [];
  /** n번째 호출(1부터)을 이 오류로 실패시킨다 */
  readonly failures = new Map<number, Error>();
  private nodes: unknown[] = [];
  private gate: (Gate & { used: boolean; arrive: () => void }) | null = null;

  constructor(
    nodes: unknown[] = [],
    private pageSize = 100,
  ) {
    this.setNodes(nodes);
  }

  setNodes(nodes: unknown[]): void {
    // 정렬은 안정적이다(같은 시각이면 입력 순서)
    const time = (node: unknown): number => Date.parse(String((node as { updatedAt?: unknown } | null)?.updatedAt)) || 0;
    this.nodes = [...nodes].sort((a, b) => time(b) - time(a));
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

  async fetchPage(cursor: string | null): Promise<FeedPage> {
    this.calls.push(cursor);
    const gate = this.gate;
    if (gate && !gate.used) {
      gate.used = true;
      gate.arrive();
      await this.released;
    }
    const failure = this.failures.get(this.calls.length);
    if (failure) throw failure;
    const start = cursor === null ? 0 : Number(cursor);
    const nodes = this.nodes.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { nodes, nextCursor: next < this.nodes.length ? String(next) : null };
  }
}
