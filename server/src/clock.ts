/** 현재 시각 공급자. 저장 시각, 스캔, 스케줄러가 모두 이것을 쓴다(테스트는 가짜 시계를 주입한다). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
