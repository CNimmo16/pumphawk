import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const path = new URL("../services/api/.dev.vars", import.meta.url);
if (!existsSync(path)) {
  writeFileSync(
    path,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nINGEST_API_KEY=${randomBytes(32).toString("hex")}\nDATABASE_URL=postgres://pumphawk:pumphawk@127.0.0.1:55435/pumphawk\n`,
    { mode: 0o600 },
  );
  console.log("Created local API secrets.");
} else console.log("Local API secrets already exist.");
