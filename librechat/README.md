# LibreChat analyst setup

LibreChat is the **internal** surface. Participants never see it — they only
ever interact over SMS. Staff use it to ask questions of the ClickHouse data in
plain language.

## 1. Create a read-only ClickHouse user

Run this against your ClickHouse Cloud service as an admin. The analyst user
must not be able to read `phone_enc` or write anything.

```sql
CREATE USER analyst IDENTIFIED BY 'CHANGE_ME';
GRANT SELECT ON sffood.v_subscribers   TO analyst;
GRANT SELECT ON sffood.v_daily_signups TO analyst;
GRANT SELECT ON sffood.v_funnel        TO analyst;
GRANT SELECT ON sffood.v_sms_cost      TO analyst;
GRANT SELECT ON sffood.pantries        TO analyst;
```

Granting on the views only — not on `sffood.*` — is what keeps `phone_enc` and
the raw `consents` text out of reach. Do not widen this to `GRANT SELECT ON
sffood.*` for convenience.

## 2. Configure and run

```bash
git clone https://github.com/danny-avila/LibreChat && cd LibreChat
cp .env.example .env
cp /Users/owner/kidseat/librechat/librechat.yaml .
cp /Users/owner/kidseat/librechat/docker-compose.override.yml .
```

Add to LibreChat's `.env`:

```
GOOGLE_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
CLICKHOUSE_HOST=<service>.clickhouse.cloud
CLICKHOUSE_ANALYST_USER=analyst
CLICKHOUSE_ANALYST_PASSWORD=...
```

Then `docker compose up -d` and open http://localhost:3080.

## 3. Questions it answers well

- Which ZIP codes have the most signups but the fewest confirmations?
- Where do Chinese-language users drop off compared to English?
- What is our SMS segment cost per confirmed subscriber, by language?
- How many people who selected "no stove" have a matching site within a mile?
