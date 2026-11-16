import type { Db } from "../db/index.ts";

/** 기준선을 만들었다는 표식 (작성자가 아니다). 이 행이 있으면 그 repo 의 첫 평가는 끝난 것이다 */
export const BASELINE_MARKER = "(baseline)";
/** 마지막으로 작성자를 평가한 시각의 표식 (`first_seen_at` 을 갱신한다) */
export const LAST_EVAL_MARKER = "(last-eval)";

/** repo 마다 기본 브랜치에서 본 작성자의 기준선. 키는 login(소문자) 또는 `email:<hash>` 이고 이메일 원문은 저장하지 않는다. */
export interface RepoAuthorsRepository {
  /** 작성자(와 표식) → 처음 본 시각 */
  list(repo: string): Map<string, string>;
  /** 기록이 있는 repo 이름 */
  listRepos(): string[];
  /** 이미 있는 작성자는 건드리지 않는다 */
  insertMany(repo: string, authors: readonly string[], now: string): void;
  /** 표식 행을 만들거나 시각을 갱신한다 */
  setMarker(repo: string, marker: string, now: string): void;
  deleteRepos(repoNames: readonly string[]): void;
  deleteAll(): void;
}

export function createRepoAuthorsRepository(db: Db): RepoAuthorsRepository {
  const listStmt = db.prepare<[string], { author: string; first_seen_at: string }>(
    "SELECT author, first_seen_at FROM repo_authors WHERE repo = ?",
  );
  const reposStmt = db.prepare<[], { repo: string }>("SELECT DISTINCT repo FROM repo_authors ORDER BY repo");
  const insertStmt = db.prepare<[string, string, string]>(
    "INSERT OR IGNORE INTO repo_authors (repo, author, first_seen_at) VALUES (?, ?, ?)",
  );
  const markerStmt = db.prepare<[string, string, string]>(
    "INSERT INTO repo_authors (repo, author, first_seen_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (repo, author) DO UPDATE SET first_seen_at = excluded.first_seen_at",
  );
  const deleteRepoStmt = db.prepare<[string]>("DELETE FROM repo_authors WHERE repo = ?");
  const deleteAllStmt = db.prepare("DELETE FROM repo_authors");
  return {
    list: (repo) => new Map(listStmt.all(repo).map((row) => [row.author, row.first_seen_at])),
    listRepos: () => reposStmt.all().map((row) => row.repo),
    insertMany(repo, authors, now) {
      for (const author of authors) insertStmt.run(repo, author, now);
    },
    setMarker: (repo, marker, now) => void markerStmt.run(repo, marker, now),
    deleteRepos(repoNames) {
      for (const name of repoNames) deleteRepoStmt.run(name);
    },
    deleteAll: () => void deleteAllStmt.run(),
  };
}
