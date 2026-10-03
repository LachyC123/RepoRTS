import type Phaser from 'phaser';

/**
 * Register a canvas as a texture WITHOUT Phaser's CanvasTexture (whose constructor and refresh()
 * perform a full getImageData readback — very slow on mobile GPUs). Updates are pushed with
 * `texture.source[0].update()`.
 */
export function canvasTexture(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): Phaser.Textures.Texture {
  const tm = scene.textures;
  if (tm.exists(key)) tm.remove(key);
  const t = tm.create(key, canvas, canvas.width, canvas.height)!;
  t.add('__BASE', 0, 0, 0, canvas.width, canvas.height);
  return t;
}
