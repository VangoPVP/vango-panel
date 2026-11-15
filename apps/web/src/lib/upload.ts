export type UploadTarget = { url: string; token: string; chunkSize: number };

export class UploadError extends Error {}

function putChunk(
  url: string,
  body: Blob,
  onProgress: (sentInChunk: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(new UploadError("Network error while uploading"));
    xhr.onabort = () => reject(new UploadError("Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export async function uploadFile(
  target: UploadTarget,
  file: File,
  path: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = file.size;
  let offset = 0;
  let conflicts = 0;
  do {
    const end = Math.min(total, offset + target.chunkSize);
    const qs = new URLSearchParams({ token: target.token, file: path, offset: String(offset), total: String(total) });
    const res = await putChunk(`${target.url}?${qs}`, file.slice(offset, end), (sent) => onProgress(offset + sent, total), signal);
    if (res.status === 409) {
      const expected = (res.json as { expected_offset?: number } | null)?.expected_offset;
      if (typeof expected !== "number" || ++conflicts > 3) throw new UploadError("Upload got out of sync, try again");
      offset = expected;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      const msg = (res.json as { error?: string } | null)?.error;
      throw new UploadError(msg ?? `Upload failed (HTTP ${res.status})`);
    }
    offset = end;
    onProgress(offset, total);
  } while (offset < total);
}
