import type { Db } from "../db/index.ts";

/** repo 마다 기본 브랜치에서 본 작성자의 기준선. 키는 login(소문자) 또는 `email:<hash>` 이고 이메일 원문은 저장하지 않는다. */
export interface RepoAuthorsRepository {
  /** 작성자 → 처음 본 시각 */
  list(repo: string): Map<string, string>;
  /** 이미 있는 작성자는 건드리지 않는다 */
  insertMany(repo: string, authors: readonly string[], now: string): void;
}

export function createRepoAuthorsRepository(db: Db): RepoAuthorsRepository {
  const listStmt = db.prepare<[string], { author: string; first_seen_at: string }>(
    "SELECT author, first_seen_at FROM repo_authors WHERE repo = ?",
  );
  const insertStmt = db.prepare<[string, string, string]>(
    "INSERT OR IGNORE INTO repo_authors (repo, author, first_seen_at) VALUES (?, ?, ?)",
  );
  return {
    list: (repo) => new Map(listStmt.all(repo).map((row) => [row.author, row.first_seen_at])),
    insertMany(repo, authors, now) {
      for (const author of authors) insertStmt.run(repo, author, now);
    },
  };
}
