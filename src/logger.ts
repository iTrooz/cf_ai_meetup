// Automatically use pino-pretty if available in Cloudflare Workers 
// https://gist.github.com/iTrooz/179e498d181f811ec6ebc30396a73f51
import { pino, type DestinationStream } from "pino";
import { Writable } from "stream";

// Setup pino logger, using pino-pretty if available (should only be used for dev, not prod !)
export async function setupLogger() {
  // See later
  const consoleStream = new Writable({
    write(chunk, _, callback) {
      console.log(chunk.toString());
      callback();
    }
  });

  let maybePretty: DestinationStream | undefined = undefined;
  if (typeof window === 'undefined') {
    try {
      // @ts-ignore
      const pinoPretty = (await import("pino-pretty"));
      maybePretty = pinoPretty.build({
        colorize: true,
        // SonicBoom (default destination) seem not to be working here
        // using process.stdout will have a prefix: https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/#stdio
        // So we are creating our own stream that writes to console.log  
        destination: consoleStream,
      });
      console.log("Using pino-pretty for logging");
    } catch (e) {
      console.warn("pino-pretty not available, using structured logging");
    }
  }
  const logger = pino({
    level: 'info', // min level to log
  }, maybePretty);

  logger.info("Logger initialized");
  return logger;
}
