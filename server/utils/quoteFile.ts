import path from 'node:path';
import XLSX from 'xlsx';

const mimeByExtension: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.eml': 'message/rfc822',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export const MAX_QUOTE_FILE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_QUOTE_EXTENSIONS = Object.keys(mimeByExtension);

function decodeXml(value: string): string {
  return value.replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function extractDocxText(buffer: Buffer): string {
  const archive = XLSX.CFB.read(buffer, { type: 'buffer' });
  const documentIndex = archive.FullPaths.findIndex((filePath: string) => /(?:^|\/)word\/document\.xml$/.test(filePath));
  const document = archive.FileIndex[documentIndex] as { content?: Uint8Array } | undefined;
  if (!document?.content) throw new Error('The Word file has no readable document body.');
  const xml = Buffer.from(document.content).toString('utf8');
  return decodeXml(xml
    .replace(/<w:tab\s*\/?\s*>/g, '\t')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')).trim();
}

export function prepareQuoteFile(filename: string, base64: string) {
  const extension = path.extname(filename).toLowerCase();
  const mimeType = mimeByExtension[extension];
  if (!mimeType) throw new Error(`Unsupported file type. Use ${SUPPORTED_QUOTE_EXTENSIONS.join(', ')}.`);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new Error('The uploaded file data is invalid.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_QUOTE_FILE_BYTES) throw new Error('The file must be between 1 byte and 10 MB.');

  let content: string;
  let multimodal = false;
  if (['.txt', '.csv', '.tsv', '.eml'].includes(extension)) {
    content = buffer.toString('utf8');
  } else if (extension === '.docx') {
    content = extractDocxText(buffer);
  } else if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    content = workbook.SheetNames.map((sheetName) =>
      `Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false })}`
    ).join('\n\n');
  } else {
    content = 'The original supplier document is attached. Read its visible text and tables directly.';
    multimodal = true;
  }
  if (!content.trim()) throw new Error('No readable quote content was found in the file.');
  return { buffer, mimeType, content, multimodal };
}
