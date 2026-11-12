// 라우트 4개.
// `/` DashboardPage, `/blacklist` BlacklistPage, `/scans` ScansPage, `/settings` SettingsPage (AppLayout 안).
import { Navigate, Route, Routes } from "react-router";
import { AppLayout } from "@/app/AppLayout";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
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
        {/* 알 수 없는 경로는 대시보드로 보낸다 — 근거: Spec 에 404 화면이 없다(라우트 4개만 정의) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
