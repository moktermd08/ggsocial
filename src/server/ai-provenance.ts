import "server-only";

/**
 * Reads an uploaded image's content credentials to see whether it was marked
 * as AI-generated. Generators that follow C2PA / IPTC write the standard
 * "digital source type" value into the file; we look for it, and never guess
 * from how the picture looks. The playbook flags such images on LinkedIn.
 *
 * true  = the credentials say AI-generated
 * false = credentials are present and say nothing of the kind
 * null  = no credentials to read (most files): unknown, not a pass
 */
const AI_SOURCE = /(trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia)/;
const HAS_CREDENTIALS = /(c2pa|jumb|digitalSourceType)/;
const MAX_SCAN = 8 * 1024 * 1024;

export async function aiGeneratedMark(file: File): Promise<boolean | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    // Credentials sit in the file's metadata blocks, which for images this size are inside the first few MB.
    const head = Buffer.from(await file.slice(0, MAX_SCAN).arrayBuffer()).toString("latin1");
    if (AI_SOURCE.test(head)) return true;
    return HAS_CREDENTIALS.test(head) ? false : null;
  } catch {
    return null;
  }
}
