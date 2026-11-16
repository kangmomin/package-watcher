import type { BlacklistService } from "./blacklistService.ts";
import type { FeedService } from "./feedService.ts";
import type { FindingService } from "./findingService.ts";
import type { Notifier } from "./notifier.ts";
import type { ScanService } from "./scanService.ts";
import type { SettingsService } from "./settingsService.ts";

/** REST 라우트와 MCP tool 이 같은 서비스 함수를 호출한다. */
export interface AppServices {
  feed: FeedService;
  findings: FindingService;
  blacklist: BlacklistService;
  scans: ScanService;
  settings: SettingsService;
  notifier: Notifier;
}
