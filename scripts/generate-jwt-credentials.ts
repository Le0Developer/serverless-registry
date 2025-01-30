import { writeFile } from "fs/promises";
import { RegistryTokens } from "../src/token";
import { createInterface } from "readline";

(async () => {
  const [privateKey, publicKey] = await RegistryTokens.createPrivateAndPublicKey();

  console.log("Public key:", publicKey);
  console.log("Private key:", privateKey);

  // ask the user if they want to save the keys to a file
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Do you want to save the keys to a file? (y/n): ", async (answer) => {
    if (answer === "y") {
      const fs = await import("fs");
      await writeFile("private-key.txt", privateKey);
      await writeFile("public-key.txt", publicKey);
      console.log("Keys saved to private-key.txt and public-key.txt");
    }
    rl.close();
  });
})();
