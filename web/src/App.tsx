// Phase 6.0 스모크용 최소 화면. Phase 6.2 에서 실제 앱으로 바꾼다.
import { ERROR_CODES } from "@pw/shared";

export default function App() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Package Watcher</h1>
      <p className="text-sm text-neutral-500">계약 에러 코드 {ERROR_CODES.length}개</p>
    </main>
  );
}
