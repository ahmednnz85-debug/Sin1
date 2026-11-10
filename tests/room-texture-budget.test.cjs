const test = require('node:test');
const assert = require('node:assert/strict');
const Budget = require('../room-texture-budget.js');

test('caps non-floor textures to 1024 and floors to 2048', () => {
  Budget.reset();
  const draws = [];
  global.document = {
    createElement() {
      return {
        width: 0, height: 0,
        getContext() {
          return {
            drawImage(img, x, y, w, h) { draws.push({ w, h, from: [img.width, img.height] }); }
          };
        }
      };
    }
  };
  const big = { isTexture: true, name: 'wall', image: { width: 4096, height: 4096 }, generateMipmaps: false, needsUpdate: false };
  const floor = { isTexture: true, name: 'floor-marble', image: { width: 4096, height: 4096 }, generateMipmaps: false, needsUpdate: false };
  assert.equal(Budget.capTexture(big, 'wall'), true);
  assert.equal(big.image.width, 1024);
  assert.equal(Budget.capTexture(floor, 'floor'), true);
  assert.equal(floor.image.width, 2048);
  // Second pass is a no-op (shared texture / already seen).
  assert.equal(Budget.capTexture(big, 'wall'), false);
  assert.ok(draws.length >= 2);
});
