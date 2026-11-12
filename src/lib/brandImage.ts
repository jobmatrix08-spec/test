const SUPPORTED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SOURCE_SIZE = 10 * 1024 * 1024;
const MAX_LOGO_DATA_URL_SIZE = 350 * 1024;

export async function resizeLogoToDataUrl(file: File): Promise<string> {
  if (!SUPPORTED_LOGO_TYPES.has(file.type)) {
    throw new Error('Unsupported logo image type.');
  }
  if (file.size > MAX_SOURCE_SIZE) {
    throw new Error('Logo image is too large.');
  }

  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 256 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the logo image.');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Unable to convert the logo image.');
    if (blob.size > MAX_LOGO_DATA_URL_SIZE) throw new Error('Converted logo image is too large.');

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unable to read the converted logo image.'));
      reader.onerror = () => reject(new Error('Unable to read the converted logo image.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    image.close();
  }
}
