// Soft studio light as an image, so metal and lenses have something believable to reflect.
import * as THREE from 'three';
export function studioEnv(renderer) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#f6f4f0'); g.addColorStop(.42, '#b9b5ae'); g.addColorStop(.52, '#56534f'); g.addColorStop(1, '#2d2b29');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  const box = (px, py, w, h, a) => { x.fillStyle = `rgba(255,255,255,${a})`; x.fillRect(px, py, w, h); };
  box(120, 70, 170, 190, 1); box(470, 40, 120, 120, 1); box(760, 80, 150, 170, 1);
  x.fillStyle = 'rgba(25,25,28,.85)'; x.fillRect(330, 110, 60, 180); x.fillRect(640, 120, 50, 170);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromEquirectangular(t); pm.dispose(); return rt.texture;
}
