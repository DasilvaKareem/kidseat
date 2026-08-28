import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // Single 24h opt-in reminder. Runs hourly; the query picks up only the
    // people who crossed the 24h mark and were never reminded.
    { path: "/api/sms/cron", schedule: "0 * * * *" },
  ],
};
