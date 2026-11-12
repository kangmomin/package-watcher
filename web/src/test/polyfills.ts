// jsdom 에 없는 브라우저 API. Radix(Select, Popper)·sonner·sidebar 가 사용한다.
// 이미 있으면 덮어쓰지 않는다.

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

if (typeof globalThis.ResizeObserver !== "function") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

const elementProto = Element.prototype as Element & Record<string, unknown>;
if (typeof elementProto.hasPointerCapture !== "function") {
  elementProto.hasPointerCapture = () => false;
}
if (typeof elementProto.setPointerCapture !== "function") {
  elementProto.setPointerCapture = () => {};
}
if (typeof elementProto.releasePointerCapture !== "function") {
  elementProto.releasePointerCapture = () => {};
}
if (typeof elementProto.scrollIntoView !== "function") {
  elementProto.scrollIntoView = () => {};
}
