/** Count payload bytes, not the size of the remote OM file.
 * HEAD responses often return Content-Length for the ENTIRE model file, even
 * though zero bytes were transferred. HTTP 206 uses Content-Range to report
 * only the actual partial payload size. */
export function spatialTransferBytes(
  method: string,
  status: number,
  headers: Readonly<Record<string, string | number>>,
  data: unknown,
): number {
  if (method.toUpperCase() === "HEAD") return 0;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  const read = (name: string) => {
    const match = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
    return match?.[1] == null ? "" : String(match[1]);
  };
  if (status === 206) {
    const range = read("content-range").match(/^bytes\s+(\d+)-(\d+)\/(?:\d+|\*)$/i);
    if (range) {
      const start = Number(range[1]), end = Number(range[2]);
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start) {
        return end - start + 1;
      }
    }
  }
  const len = Number(read("content-length"));
  return Number.isSafeInteger(len) && len > 0 ? len : 0;
}
