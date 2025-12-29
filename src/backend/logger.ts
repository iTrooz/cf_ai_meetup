// Automatically use pino-pretty if available in Cloudflare Workers 
// Note that pino-pretty needs to be installed in prod too with this solution, but it will not be used
// https://gist.github.com/iTrooz/179e498d181f811ec6ebc30396a73f51
import { pino, type DestinationStream } from "pino";
import { Writable } from "stream";
import pinoPretty from "pino-pretty";

// Setup pino logger, using pino-pretty if available (should only be used for dev, not prod !)
export function setupLogger() {
  // See later
  const consoleStream = new Writable({
    write(chunk, _, callback) {
      console.log(chunk.toString());
      callback();
    }
  });

  let maybePretty: DestinationStream = consoleStream;
  if (Object.keys(pinoPretty).length > 0 && import.meta.env.DEV) {
    maybePretty = pinoPretty.build({
      colorize: true,
      // SonicBoom (default destination) seem not to be working here
      // Maybe linked to https://github.com/pinojs/sonic-boom/pull/236
      // using process.stdout will have a prefix: https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/#stdio
      // So we are creating our own stream that writes to console.log  
      destination: consoleStream,
    });
    console.log("Using pino-pretty for logging");
  } else {
    console.log("Using pino structured logging");
  }

  const logger = pino({
    level: 'info', // min level to log
  }, maybePretty);

  return logger;
}
