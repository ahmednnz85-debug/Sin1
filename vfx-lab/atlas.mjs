const PAD = 8;
const CELL = 256;
const WIDTH = 1024, HEIGHT = 512;
const steps = { ground: 10, energy: 4, sparks: 4 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function canvas(width, height) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  return image;
}
function rectangles(rows, reference, width, height) {
  return rows.flatMap(({ top, bottom, edges }) => edges.slice(1).map((right,i) => {
    const x = Math.round(edges[i] * width / reference);
    const y = Math.round(top * height / reference);
    return [x, y, Math.round(right * width / reference) - x, Math.round(bottom * height / reference) - y];
  }));
}
export function extractMatte(ctx, width, height, kind) {
  const rgba = ctx.getImageData(0, 0, width, height);
  const data = rgba.data;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const edge = clamp(Math.min(x, width - x - 1, y, height - y - 1) / 4, 0, 1);
    const max = Math.max(data[i], data[i+1], data[i+2]);
    const a = kind === 'ground' ? clamp((max - 10) / 47, 0, 1) :
      clamp((max - 4) / 251, 0, 1);
    const sourceAlpha = data[i + 3] / 255;
    if (a > .006 && sourceAlpha > 0) {
      const gain = kind === 'ground' ? Math.min(1.38, 1 / a) : 1 / a;
      for (let channel = 0; channel < 3; channel++) data[i + channel] *= gain;
    } else data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = Math.round(255 * a * edge * sourceAlpha);
  }
  ctx.putImageData(rgba,0,0);
}
/** Static atlas cells are independent material samples. Each page has UV gutters. */
export async function importSheet(file, kind) {
  if (!(kind in steps)) throw new Error('Unknown VFX sheet');
  if (file.size > 24 * 1024 * 1024) throw new Error('أقصى حجم للصورة 24 MiB');
  const layout = await fetch(new URL('atlas-layout.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('تعذّر تحميل خريطة الخامات');
    return response.json();
  });
  const source = await createImageBitmap(file);
  try {
    if (Math.max(source.width, source.height) > 4096 || Math.abs(source.width / source.height - 1) > .08) {
      throw new Error('استخدم الصورة المرجعية المربعة بحجم لا يتجاوز 4096×4096');
    }
    const spec = layout.sheets[kind];
    const rects = rectangles(spec.rows, layout.referenceSize, source.width, source.height);
    const images = rects.map(([x,y,w,h]) => {
      const cropped = canvas(w,h);
      const ctx = cropped.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source,x,y,w,h,0,0,w,h);
      extractMatte(ctx,w,h,kind);
      return cropped;
    });
    const atlas = canvas(WIDTH,HEIGHT);
    const ctx = atlas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const regions = spec.detail.map((j,index) => {
      const image = images[j];
      const dx = index % 4 * CELL + PAD;
      const dy = Math.floor(index/4) * CELL + PAD;
      const scale = (CELL - 2 * PAD) / Math.max(image.width,image.height);
      const w = Math.round(image.width*scale);
      const h = Math.round(image.height*scale);
      ctx.drawImage(image,dx,dy,w,h);
      return [(dx+.5)/WIDTH,1-(dy+h-.5)/HEIGHT,(w-1)/WIDTH,(h-1)/HEIGHT];
    });
    return { atlas, regions, images };
  } finally { source.close(); }
}

export function canvasTexture(T, atlas) {
  const texture = new T.CanvasTexture(atlas);
  // Alpha is sampled as coverage by the shaders. RGB retains the source sRGB palette.
  texture.colorSpace = T.SRGBColorSpace;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 2;
  return texture;
}
