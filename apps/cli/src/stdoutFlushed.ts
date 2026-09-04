/**
 * Write to stdout and resolve only once the data has been handed to the OS.
 *
 * cli.ts calls process.exit(code) the moment a command returns; a bare
 * console.log / process.stdout.write into a PIPED stdout can still be
 * buffered at that point, and process.exit does not wait for the drain —
 * truncating output mid-stream. Awaiting the write callback closes that
 * window. Shared by every command that emits machine-consumed stdout
 * (create --json payloads, spec documents piped to files/pagers).
 */
export function writeStdoutFlushed(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
  });
}
