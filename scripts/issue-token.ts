import { readFile } from "fs/promises";
import { RegistryTokens } from "../src/token";
import { createInterface } from "readline/promises";
import { RegistryTokenCapability } from "../src/auth";

async function getPrivatKey() {
  try {
    return await readFile("private-key.txt", "utf-8");
  } catch {}
  console.log(
    "No public key found. Please run generate-jwt-credentials.ts first or provide a public key in private-key.txt",
  );
  process.exit(1);
}

// returns time in minutes or undefined if empty
function decodeTime(time: string) {
  if (time === "") return undefined;

  if (time.endsWith("m")) {
    return parseInt(time.slice(0, -1));
  }
  if (time.endsWith("h")) {
    return parseInt(time.slice(0, -1)) * 60;
  }
  if (time.endsWith("d")) {
    return parseInt(time.slice(0, -1)) * 60 * 24;
  }
  if (time.endsWith("s")) {
    return parseInt(time.slice(0, -1)) / 60;
  }

  console.warn("Failed to parse time, expected format: 1m, 1h, 1d, 1s");
  process.exit(2);
}

(async () => {
  const privateKey = await getPrivatKey();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const readOnly = await rl.question("Read-only access? (y/N): ");
  const expireTime = await rl.question("Expiry (leave empty for infinite, eg. 30d): ");
  const restrictedNamespaces = await rl.question("Restricted namespaces (comma separated): ");

  const registryTokens = new RegistryTokens("" as any);

  const capabilities = readOnly
    ? (["pull"] as RegistryTokenCapability[])
    : (["pull", "push"] as RegistryTokenCapability[]);
  const namespaces = restrictedNamespaces ? restrictedNamespaces.replace(/\s/g, "").split(",") : [];
  const expiry = decodeTime(expireTime);

  console.log({
    capabilities,
    namespaces,
    expiry,
  });
  const token = await registryTokens.createToken(capabilities, privateKey, namespaces, expiry);

  console.log("Token:", token);

  const username = namespaces.length ? namespaces[0] : "user";
  const encoded = btoa(`${username}:${token}`);
  console.log("Basic token:", encoded);

  rl.close();
})();
