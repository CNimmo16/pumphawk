import { writeFileSync } from "node:fs";
import { createApp, openApiDocument } from "../src/app/app";
writeFileSync(
  new URL("../../../packages/openapi/openapi.json", import.meta.url),
  JSON.stringify(createApp().getOpenAPI31Document(openApiDocument), null, 2) +
    "\n",
);
console.log("Generated OpenAPI 3.1 contract.");
