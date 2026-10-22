import { RobotProvider, RobotView } from "@/components/common/robot-view";
import { SiteMotion } from "@/components/motion/site-motion";
import { Preloader } from "@/components/preloader/preloader";

import { HomeView } from "./home";

/**
 * `/` — the preloader, then the home view with its motion set playing.
 * `robot` (D-016, `/robot-view` via the proxy): no preloader, every reveal at
 * rest — same content, same metadata.
 */
export const HomePageView = ({ robot = false }: { robot?: boolean }) => (
  <RobotProvider robot={robot}>
    {robot && <RobotView />}
    <SiteMotion gated={!robot}>
      <HomeView overlay={robot ? null : <Preloader />} />
    </SiteMotion>
  </RobotProvider>
);
