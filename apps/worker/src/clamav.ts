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
  socket.setTimeout(timeoutMs);
  let response = '';
  const result = new Promise<string>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('CLAMAV_TIMEOUT'));
    });
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
    });
    socket.once('end', () => resolve(response.trim()));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write('zINSTREAM\0');
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 }) as AsyncIterable<Buffer>;
  for await (const chunk of stream) {
    await writeChunk(socket, Buffer.from(chunk));
  }
  const terminator = Buffer.alloc(4);
  await new Promise<void>((resolve) => socket.end(terminator, resolve));
  const message = await result;
  if (message.endsWith('OK')) return { status: 'CLEAN', response: message };
  const found = message.match(/: (.+) FOUND$/);
  if (found?.[1]) return { status: 'INFECTED', signature: found[1], response: message };
  throw new Error(`CLAMAV_ERROR:${message.slice(0, 200)}`);
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
