/**
 * Reads an image's or video's pixel size (and a video's length) in the
 * browser before upload, so the playbook can check sizes and aspect ratios
 * without the server decoding media. Anything it cannot read comes back
 * empty, and the playbook asks a person to check that file by eye.
 */
export type Dims = { width: number | null; height: number | null; durationMs: number | null };

const EMPTY: Dims = { width: null, height: null, durationMs: null };

export function readDims(file: File): Promise<Dims> {
  const url = URL.createObjectURL(file);
  const done = (d: Dims) => { URL.revokeObjectURL(url); return d; };
  return new Promise<Dims>((resolve) => {
    // A file the browser cannot decode must not hold the upload up.
    const timer = setTimeout(() => resolve(done(EMPTY)), 8000);
    const finish = (d: Dims) => { clearTimeout(timer); resolve(done(d)); };
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => finish({ width: img.naturalWidth || null, height: img.naturalHeight || null, durationMs: null });
      img.onerror = () => finish(EMPTY);
      img.src = url;
    } else if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => finish({
        width: v.videoWidth || null, height: v.videoHeight || null,
        durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null,
      });
      v.onerror = () => finish(EMPTY);
      v.src = url;
    } else {
      finish(EMPTY);
    }
  });
}

/** Appends each file with its size, in order, as the upload actions expect. */
export async function withDims(files: File[], fd = new FormData()) {
  const dims = await Promise.all(files.map(readDims));
  for (const f of files) fd.append("files", f);
  fd.append("dims", JSON.stringify(dims));
  return fd;
}
