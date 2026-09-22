import { useQuery } from "@tanstack/react-query";
import {
  getDashboardOptions,
  getDriverOptions,
  getForecastOptions,
  getTrackedStationsOptions,
  getWeeklyOutlookOptions,
} from "@pump-hawk/openapi/react-query";
import { auth, errorCode } from "./api";
export function useDashboard() {
  const session = auth.useSession();
  const signedIn = !!session.data?.user;
  const national = useQuery({
    ...getForecastOptions(),
    staleTime: 60_000,
    refetchInterval: 3_600_000,
  });
  const driver = useQuery({
    ...getDriverOptions(),
    enabled: signedIn,
    retry: false,
  });
  const personal = useQuery({
    ...getDashboardOptions(),
    enabled: signedIn && !!driver.data,
    refetchInterval: 3_600_000,
  });
  const weekly = useQuery({
    ...getWeeklyOutlookOptions(),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
  });
  const tracked = useQuery({
    ...getTrackedStationsOptions(),
    enabled: signedIn,
    refetchInterval: 3_600_000,
  });
  const missing = errorCode(driver.error) === "DRIVER_NOT_FOUND";
  return {
    session,
    signedIn,
    national,
    driver,
    personal,
    weekly,
    tracked,
    forecast: signedIn
      ? (personal.data?.forecast ?? national.data)
      : national.data,
    advice: signedIn ? personal.data?.recommendation : undefined,
    car: signedIn ? (personal.data?.driver ?? driver.data) : undefined,
    onboarding:
      signedIn &&
      (missing || (!!driver.data && !driver.data.onboardingComplete)),
    loadingAdvice:
      session.isPending ||
      (signedIn && (driver.isPending || (!!driver.data && personal.isPending))),
    failure:
      session.error ||
      (signedIn ? (!missing && driver.error) || personal.error : undefined),
    retryAdvice: async () => {
      if (session.error) await session.refetch();
      else if (driver.error) await driver.refetch();
      else await personal.refetch();
    },
  };
}
