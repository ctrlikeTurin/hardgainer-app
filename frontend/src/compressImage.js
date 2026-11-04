// Phone photos are 3-8 MB; Gemini only needs ~1024px to read a plate.
// Shrinking in the browser cuts upload time and image tokens by ~10-20x.
export async function compressImage(file, maxDim = 1024, quality = 0.8) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it; the backend accepts it as-is
  }
}
