// 라우트 5개.
// `/` DashboardPage, `/blacklist` BlacklistPage, `/scans` ScansPage, `/settings` SettingsPage (AppLayout 안).
// `/feed` FeedPage 는 상단 메뉴에 없다 — 설정 화면의 "목록 검색" 링크로만 간다.
import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/app/AppLayout";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { FeedPage } from "@/features/feed/FeedPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { ScansPage } from "@/features/scans/ScansPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="blacklist" element={<BlacklistPage />} />
        <Route path="scans" element={<ScansPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="feed" element={<FeedPage />} />
        {/* 알 수 없는 경로는 대시보드로 보낸다 — 근거: Spec 에 404 화면이 없다(메뉴의 라우트만 정의) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
