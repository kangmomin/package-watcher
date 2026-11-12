import { useLocation } from "react-router";

export const LOCATION_TEST_ID = "test-location";

/** 현재 라우터 pathname 을 노출한다 (toast action 등으로 이동했는지 확인용). */
export function LocationProbe() {
  const location = useLocation();
  return <output data-testid={LOCATION_TEST_ID}>{location.pathname}</output>;
}
