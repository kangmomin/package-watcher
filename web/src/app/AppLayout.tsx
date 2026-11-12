// 사이드바 레이아웃.
// 왼쪽 사이드바: 대시보드 / 블랙리스트 / 스캔 이력 / 설정. 오른쪽 = Outlet.
import { HistoryIcon, LayoutDashboardIcon, SettingsIcon, ShieldBanIcon, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "대시보드", icon: LayoutDashboardIcon },
  { to: "/blacklist", label: "블랙리스트", icon: ShieldBanIcon },
  { to: "/scans", label: "스캔 이력", icon: HistoryIcon },
  { to: "/settings", label: "설정", icon: SettingsIcon },
];

function isActive(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

export function AppLayout() {
  const { pathname } = useLocation();

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <p className="px-2 py-1.5 text-base font-semibold">Package Watcher</p>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="주 메뉴">
                <SidebarMenu>
                  {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={isActive(pathname, to)}>
                        <NavLink to={to} end={to === "/"}>
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger aria-label="메뉴 열기" />
          <span className="font-semibold">Package Watcher</span>
        </header>
        <div className="flex-1 p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
