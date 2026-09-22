import { readFile, writeFile, mkdir } from "node:fs/promises";
const artifact = JSON.parse(
  await readFile(
    new URL("../../../contracts/out/MockPaymentUSD.sol/MockPaymentUSD.json", import.meta.url),
    "utf8",
  ),
);
const bytecode = artifact.bytecode.object;
const deployedBytecode = artifact.deployedBytecode.object;
if (!/^0x[0-9a-f]+$/i.test(bytecode) || !/^0x[0-9a-f]+$/i.test(deployedBytecode))
  throw new Error("Compile MockPaymentUSD before exporting.");
const directory = new URL("../src/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("payment-token.json", directory),
  JSON.stringify({ bytecode, deployedBytecode }, null, 2) + "\n",
);
