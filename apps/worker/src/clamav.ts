import { createReadStream } from 'node:fs';
import { connect } from 'node:net';

export type ScanResult =
  | { status: 'CLEAN'; response: string }
  | { status: 'INFECTED'; signature: string; response: string };

function writeChunk(socket: ReturnType<typeof connect>, chunk: Buffer): Promise<void> {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(chunk.length, 0);
  return new Promise((resolve, reject) => {
    socket.write(Buffer.concat([length, chunk]), (error) => (error ? reject(error) : resolve()));
  });
}

export async function scanFile(
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<ScanResult> {
  const socket = connect({ host, port });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(new Error('CLAMAV_TIMEOUT'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('error', onError);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
    socket.setTimeout(timeoutMs);
    let response = '';
    const result = new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };
      socket.once('error', (error) => finish(() => reject(error)));
      socket.once('timeout', () => {
        finish(() => reject(new Error('CLAMAV_TIMEOUT')));
        socket.destroy();
      });
      socket.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf8');
      });
      socket.once('end', () => finish(() => resolve(response.trim())));
      socket.once('close', () =>
        finish(() => reject(new Error('CLAMAV_CONNECTION_CLOSED_WITHOUT_RESPONSE'))),
      );
    });
    // A socket/write failure can reject both the write operation and the
    // response promise. Attach a handler immediately so the latter never
    // becomes an unhandled rejection while the write path is unwinding.
    void result.catch(() => undefined);
    socket.write('zINSTREAM\0');
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 }) as AsyncIterable<Buffer>;
    for await (const chunk of stream) {
      await writeChunk(socket, Buffer.from(chunk));
    }
    socket.end(Buffer.alloc(4));
    // ClamAV's zero-terminated protocol includes the trailing NUL byte in the
    // response. Normalise protocol framing before interpreting the status.
    const message = (await result).replaceAll('\0', '').trim();
    if (message.endsWith('OK')) return { status: 'CLEAN', response: message };
    const found = message.match(/: (.+) FOUND$/);
    if (found?.[1]) return { status: 'INFECTED', signature: found[1], response: message };
    throw new Error(`CLAMAV_ERROR:${message.slice(0, 200)}`);
  } finally {
    socket.destroy();
  }
}

export async function pingClamAv(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  const socket = connect({ host, port });
  socket.setTimeout(timeoutMs);
  return new Promise((resolve) => {
    let response = '';
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.includes('PONG')) finish(true);
    });
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.once('end', () => finish(response.includes('PONG')));
  });
}
