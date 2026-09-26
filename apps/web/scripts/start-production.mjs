import { spawn } from "node:child_process";

  const children = new Set();
  let stopping = false;

  function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;

    for (const child of children) {
      child.kill("SIGTERM");
    }

    // Allow ongoing work time to finish before forcing shutdown.
    setTimeout(() => {
      for (const child of children) {
        child.kill("SIGKILL");
      }
    }, 60_000).unref();
  }

  function start(name, args) {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: process.env,
    });

    children.add(child);

    child.on("error", () => {
      console.error(`${name} could not start.`);
      stop(1);
    });
    child.on("close", () => {
      children.delete(child);

      if (!stopping) {
        console.error(`${name} stopped unexpectedly.`);
        stop(1);
      }
    });
  }

  process.on("SIGTERM", () => stop());
  process.on("SIGINT", () => stop());

  start("Website", [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname", "0.0.0.0",
    "--port", process.env.PORT || "3000",
  ]);

 if (process.env.STEWARD_WORKER_ENABLED === "true") {
    start("WhatsApp worker", [
      "--import", "tsx",
      "scripts/whatsapp-worker.ts",
    ]);
  } else {
    console.log("WhatsApp worker is paused.");
  }

