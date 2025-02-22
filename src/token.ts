import { decode } from "@cfworker/base64url";
import jwt from "@tsndr/cloudflare-worker-jwt";
import {
  RegistryTokenCapability,
  RegistryAuthProtocolTokenPayload,
  stripUsernamePasswordFromHeader,
  Authenticator,
} from "./auth";

export function importKeyFromBase64(key: string): JsonWebKey {
  // Decodes the base64 value and performs unicode normalization.
  return JSON.parse(decode(key));
}

export async function newRegistryTokens(jwtPublicKey: string): Promise<RegistryTokens> {
  return new RegistryTokens(importKeyFromBase64(jwtPublicKey));
}

export class RegistryTokens implements Authenticator {
  private jwtPublicKey: JsonWebKey;
  authmode: string;

  constructor(jwtPublicKey: JsonWebKey) {
    this.authmode = "RegistryTokens";
    this.jwtPublicKey = jwtPublicKey;
  }

  /**
   * Very util function that showcases how do we generate private and public keys
   *
   * @example
   *    // Sample usage:
   *    try {
   *      const [privateKey, publicKey] = await RegistryTokens.createPrivateAndPublicKey();
   *      const registryTokens = await newRegistryTokens(publicKey);
   *      const token = await registryTokens.createToken("some-account-id", ["pull", "push"], 30, privateKey, "https://hello.com");
   *      const result = await registryTokens.verifyToken(request, token);
   *      console.log(JSON.stringify(result));
   *    } catch (err) {
   *      console.log("Error generating keys:", err.message);
   *    }
   */
  static async createPrivateAndPublicKey(): Promise<[string, string]> {
    const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const exportedPrivateKey = btoa(JSON.stringify(await crypto.subtle.exportKey("jwk", key.privateKey)));
    const exportedPublicKey = btoa(JSON.stringify(await crypto.subtle.exportKey("jwk", key.publicKey)));
    return [exportedPrivateKey, exportedPublicKey];
  }

  async createToken(
    caps: RegistryTokenCapability[],
    privateKeyString: string,
    namespaces: string[],
    expirationMinutes?: number,
    accountID?: string,
  ): Promise<string> {
    const privateKey = importKeyFromBase64(privateKeyString);
    // password is the signed JWT from the tokenPayload. Clients would treat this as an opaque identifier
    const tokenPayload: RegistryAuthProtocolTokenPayload = {
      username: "v0",
      account_id: accountID,
      capabilities: caps,
      iat: Math.floor(Date.now() / 1000),
      aud: namespaces,
    };
    if (expirationMinutes !== undefined) {
      tokenPayload.exp = Math.floor(Date.now() / 1000) + 60 * expirationMinutes;
    }

    const token = await jwt.sign(tokenPayload, privateKey, {
      algorithm: "ES256",
    });

    return token;
  }

  static checkIfV2OnlyPath(request: Request): boolean {
    return request.url.endsWith("/v2/");
  }

  async verifyToken(
    request: Request,
    token: string,
  ): Promise<{
    verified: boolean;
    payload: RegistryAuthProtocolTokenPayload | null;
  }> {
    try {
      // first verify the JWT
      if (!(await jwt.verify(token, this.jwtPublicKey, { algorithm: "ES256" }))) {
        console.warn("verifyToken: jwt.verify() failed");
        return { verified: false, payload: null };
      }

      // the JWT signature is valid, decode it now
      const decoded = jwt.decode(token);
      const payload = decoded.payload as RegistryAuthProtocolTokenPayload;
      return RegistryTokens.verifyPayload(request, payload);
    } catch (error) {
      // If the verification fails (e.g., due to token expiration or signature mismatch),
      // jwt.verify() will throw an error which we can catch here.

      // We could throw this error further up to allow more specific error handling,
      // or simply return {verified: false, payload: null  }to indicate token verification failure.
      console.warn(`verifyToken: ${(error as Error).message}`);
      return { verified: false, payload: null };
    }
  }

  static verifyPayload(request: Request, payload: RegistryAuthProtocolTokenPayload) {
    // Check if token has expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) {
      // The token has expired
      console.warn(`verifyV0Token: failed jwt verification: the token has expired`);
      return { verified: false, payload: null };
    }

    // ensure capabilities are satisfied
    switch (request.method) {
      // PULL or PUSH methods
      case "HEAD":
        // HEAD requests can be used by pushers like docker
        if (!payload.capabilities.includes("pull") && !payload.capabilities.includes("push")) {
          console.warn(
            `verifyToken: failed jwt verification: missing any capability for HEAD request in ${request.url}`,
          );
          return { verified: false, payload: null };
        }
        break;
      // PULL method
      case "GET":
        if (this.checkIfV2OnlyPath(request) && payload.capabilities.length === 0) {
          console.warn("verifyToken: failed jwt verification: missing any capabilities for GET request in /v2/");
          return { verified: false, payload: null };
        }

        if (this.checkIfV2OnlyPath(request)) {
          return { verified: true, payload };
        }

        if (!payload.capabilities.includes("pull")) {
          console.warn(
            `verifyToken: failed jwt verification: missing "pull" capability for ${request.method} HTTP method in ${request.url}`,
          );
          return { verified: false, payload: null };
        }
        break;

      // PUSH methods
      case "POST":
      case "PUT":
      case "DELETE":
      case "PATCH":
        if (!payload.capabilities.includes("push")) {
          console.warn(
            `verifyToken: failed jwt verification: missing "push" capability for ${request.method} HTTP method`,
          );
          return { verified: false, payload: null };
        }
        break;
      default:
        return { verified: false, payload: null };
    }

    const namespace = new URL(request.url).pathname.split("/")[2];
    if (payload.aud && !payload.aud.includes(namespace)) {
      console.warn(`verifyToken: failed jwt verification: namespace ${namespace} not in aud list: ${payload.aud}`);
      return { verified: false, payload: null };
    }

    return { verified: true, payload };
  }

  async checkCredentials(request: Request): Promise<{
    verified: boolean;
    payload: RegistryAuthProtocolTokenPayload | null;
  }> {
    const res = stripUsernamePasswordFromHeader(request);
    if ("verified" in res) {
      return res;
    }

    const [, password] = res;
    return this.verifyToken(request, password);
  }
}
