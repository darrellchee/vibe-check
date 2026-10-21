import type { Readable } from "node:stream";

/** JSON Lines uses LF boundaries. Unicode line separators can occur inside
 * JSON strings; readline may split on them and turn valid records into fragments.
 * A bare CR can also be valid JSON whitespace within a record. */
export async function* readJsonLines(input: Readable): AsyncGenerator<string> {
  input.setEncoding("utf8");
  let pending = "";
  for await (const chunk of input) {
    pending += chunk;
    let start = 0;
    let end: number;
    while ((end = pending.indexOf("\n", start)) !== -1) {
      yield pending.slice(start, end);
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  if (pending.length) yield pending;
}
