import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // Single 24h opt-in reminder. Daily, because Hobby allows one run per day;
    // the query's 24-72h window absorbs the coarser schedule, so someone who
    // signs up just after a run is still caught on the next one at ~48h.
    //
    // 17:00 UTC is 10am PDT / 9am PST -- inside TCPA quiet hours year-round,
    // which a fixed-time daily send has to guarantee on its own. An hourly
    // schedule reminded people near the hour they signed up; this does not.
    { path: "/api/sms/cron", schedule: "0 17 * * *" },
  ],
};
