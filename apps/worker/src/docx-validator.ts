import { fileTypeFromFile } from 'file-type';
import yauzl, { type Entry } from 'yauzl';

export interface DocxInspection {
  readonly detectedMime: string;
  readonly entryCount: number;
  readonly uncompressedBytes: number;
}

const maximumXmlPartBytes = 20 * 1024 * 1024;

export function readDocxXmlPart(path: string, partName: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('ZIP_OPEN_FAILED'));
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        zipFile.close();
        resolve(value);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zipFile.close();
        reject(error);
      };
      zipFile.on('error', fail);
      zipFile.on('entry', (entry: Entry) => {
        const normalized = entry.fileName.replaceAll('\\', '/');
        if (normalized !== partName) {
          zipFile.readEntry();
          return;
        }
        if (entry.uncompressedSize > maximumXmlPartBytes) {
          fail(new Error('DOCX_XML_PART_TOO_LARGE'));
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error('DOCX_XML_PART_READ_FAILED'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximumXmlPartBytes) {
              stream.destroy(new Error('DOCX_XML_PART_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('error', fail);
          stream.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
        });
      });
      zipFile.once('end', () => finish(null));
      zipFile.readEntry();
    });
  });
}

function inspectZip(
  path: string,
): Promise<{ names: Set<string>; entryCount: number; uncompressedBytes: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError || !zipFile) return reject(openError ?? new Error('ZIP_OPEN_FAILED'));
        const names = new Set<string>();
        let entryCount = 0;
        let uncompressedBytes = 0;
        const fail = (error: Error) => {
          zipFile.close();
          reject(error);
        };
        zipFile.on('error', reject);
        zipFile.on('entry', (entry: Entry) => {
          entryCount += 1;
          uncompressedBytes += entry.uncompressedSize;
          const normalized = entry.fileName.replaceAll('\\', '/');
          if (normalized.startsWith('/') || normalized.split('/').includes('..'))
            return fail(new Error('ZIP_PATH_TRAVERSAL'));
          if ((entry.generalPurposeBitFlag & 0x1) !== 0)
            return fail(new Error('ZIP_ENCRYPTED_ENTRY'));
          if (entryCount > 10_000 || uncompressedBytes > 200 * 1024 * 1024)
            return fail(new Error('ZIP_BOMB_LIMIT'));
          if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 200)
            return fail(new Error('ZIP_COMPRESSION_RATIO'));
          names.add(normalized);
          zipFile.readEntry();
        });
        zipFile.once('end', () => resolve({ names, entryCount, uncompressedBytes }));
        zipFile.readEntry();
      },
    );
  });
}

export async function inspectDocx(path: string): Promise<DocxInspection> {
  const type = await fileTypeFromFile(path);
  if (
    type?.ext !== 'docx' ||
    type.mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    throw new Error('SIGNATURE_NOT_DOCX');
  const zip = await inspectZip(path);
  if (!zip.names.has('[Content_Types].xml') || !zip.names.has('word/document.xml'))
    throw new Error('DOCX_STRUCTURE_INVALID');
  if ([...zip.names].some((name) => /(^|\/)vbaProject\.bin$/i.test(name)))
    throw new Error('DOCX_MACRO_NOT_ALLOWED');
  return {
    detectedMime: type.mime,
    entryCount: zip.entryCount,
    uncompressedBytes: zip.uncompressedBytes,
  };
}
