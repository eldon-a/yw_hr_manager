const IMAGE_TYPES = /^(image\/(jpeg|png|gif|webp))$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;

export function isAllowedImage(file) {
  return !!file && (IMAGE_TYPES.test(file.type || '') || IMAGE_EXTENSIONS.test(file.name || ''));
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

export function getImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 열 수 없습니다.'));
    };
    image.src = url;
  });
}

/** 큰 회원사진만 브라우저에서 축소해 업로드 대기시간과 GAS 부하를 줄인다. */
export async function prepareMemberPhoto(file) {
  if (!file) return { dataUrl: '', name: '', optimized: false };
  if (!isAllowedImage(file)) throw new Error('사진은 JPG, PNG, GIF, WEBP 형식만 사용할 수 있습니다.');
  if (file.size > 15 * 1024 * 1024) throw new Error('사진은 15MB 이하여야 합니다.');

  const size = await getImageSize(file);
  if (size.width < 400 || size.height < 600) {
    throw new Error(`사진 해상도가 너무 작습니다. 현재 ${size.width}×${size.height}px, 최소 400×600px가 필요합니다.`);
  }

  const shouldOptimize = file.size > 2 * 1024 * 1024 || size.width > 1800 || size.height > 2700;
  if (!shouldOptimize || /^image\/(gif|webp)$/i.test(file.type || '')) {
    return { dataUrl: await fileToDataUrl(file), name: file.name, optimized: false, ...size };
  }

  const scale = Math.min(1, 1800 / size.width, 2700 / size.height);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 변환하지 못했습니다.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const name = String(file.name || 'member-photo').replace(/\.[^.]+$/, '') + '.jpg';
    return { dataUrl, name, optimized: true, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function driveThumbnail(url, size = 240) {
  if (!url) return '';
  const text = String(url);
  const match = text.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${size}`;
  return /^https?:\/\//i.test(text) ? text : '';
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
