// 앱 루트: QueryClientProvider + TooltipProvider + BrowserRouter(AppRoutes) + Toaster.
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router";
import { AppRoutes } from "@/app/router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/queryClient";

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        {/* next-themes Provider 가 없다(다크 모드 전환 없음). theme 를 고정한다. */}
        <Toaster theme="light" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
