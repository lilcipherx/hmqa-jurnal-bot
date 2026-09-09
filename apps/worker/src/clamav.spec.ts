import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { scanFile } from './clamav.js';

const servers: Server[] = [];

async function scanner(response: string): Promise<number> {
  const server = createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      if (request.length >= 4 && request.subarray(-4).equals(Buffer.alloc(4))) {
        socket.end(response);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_MISSING');
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe('ClamAV INSTREAM protocol', () => {
  it('accepts a NUL-terminated clean response', async () => {
    const port = await scanner('stream: OK\0');
    await expect(scanFile('127.0.0.1', port, import.meta.filename, 2_000)).resolves.toEqual({
      status: 'CLEAN',
      response: 'stream: OK',
    });
  });

  it('extracts a signature from a NUL-terminated infected response', async () => {
    const port = await scanner('stream: Eicar-Signature FOUND\0');
    await expect(scanFile('127.0.0.1', port, import.meta.filename, 2_000)).resolves.toEqual({
      status: 'INFECTED',
      signature: 'Eicar-Signature',
      response: 'stream: Eicar-Signature FOUND',
    });
  });
});
