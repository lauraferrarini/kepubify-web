"use strict";

// Extracts enhance() and hasTransparency() straight out of edit.js and runs
// them under Node. Keeps edit.js as a plain browser script (no module system)
// while still getting the pixel maths under test.

const fs = require("fs");
const assert = require("assert");

class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} not found in edit.js`);
  let depth = 0;
  let i = source.indexOf("{", start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  assert.ok(i < source.length, `unbalanced braces in ${name}`);
  return source.slice(start, i + 1);
}

const src = fs.readFileSync(`${__dirname}/edit.js`, "utf8");
const preset = /const COVER_PRESET = ({[^}]*});/.exec(src);
assert.ok(preset, "COVER_PRESET not found");

const sandbox = new Function(
  "ImageData",
  "Uint8ClampedArray",
  "Float32Array",
  `const COVER_PRESET = ${preset[1]};
   ${extract(src, "enhance")}
   ${extract(src, "hasTransparency")}
   return { enhance, hasTransparency, COVER_PRESET };`
)(ImageData, Uint8ClampedArray, Float32Array);

const { enhance, hasTransparency, COVER_PRESET } = sandbox;

function makeImage(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a = 255], i) => {
    data.set([r, g, b, a], i * 4);
  });
  return new ImageData(data, pixels.length, 1);
}

const tests = {
  "identity settings leave pixels untouched"() {
    const img = makeImage([[120, 60, 200], [10, 200, 30], [255, 255, 255]]);
    const out = enhance(img, { saturation: 1, contrast: 0, sharpen: 0 });
    for (let i = 0; i < img.data.length; i++) {
      assert.ok(
        Math.abs(out.data[i] - img.data[i]) <= 1,
        `channel ${i}: ${out.data[i]} vs ${img.data[i]}`
      );
    }
  },

  "saturation pushes colour away from grey"() {
    const img = makeImage([[160, 90, 90]]);
    const out = enhance(img, { saturation: 1.5, contrast: 0, sharpen: 0 });
    const spreadBefore = img.data[0] - img.data[1];
    const spreadAfter = out.data[0] - out.data[1];
    assert.ok(spreadAfter > spreadBefore, `${spreadAfter} should exceed ${spreadBefore}`);
  },

  "greys stay grey under saturation"() {
    const img = makeImage([[128, 128, 128]]);
    const out = enhance(img, { saturation: 2, contrast: 0, sharpen: 0 });
    assert.strictEqual(out.data[0], out.data[1]);
    assert.strictEqual(out.data[1], out.data[2]);
  },

  "contrast steepens midtones without clipping the endpoints"() {
    const img = makeImage([[0, 0, 0], [96, 96, 96], [160, 160, 160], [255, 255, 255]]);
    const out = enhance(img, { saturation: 1, contrast: 0.5, sharpen: 0 });
    assert.strictEqual(out.data[0], 0, "black must stay black");
    assert.strictEqual(out.data[12], 255, "white must stay white");
    assert.ok(out.data[4] < 96, "below-mid tone should darken");
    assert.ok(out.data[8] > 160, "above-mid tone should brighten");
  },

  "output stays inside 0-255 at maximum strength"() {
    const img = makeImage([[250, 5, 5], [5, 250, 5], [0, 0, 0], [255, 255, 255]]);
    const out = enhance(img, { saturation: 2, contrast: 0.6, sharpen: 1.2 });
    for (const v of out.data) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 255, `out of range: ${v}`);
    }
  },

  "sharpening raises local contrast at an edge"() {
    const img = makeImage([[40, 40, 40], [40, 40, 40], [210, 210, 210], [210, 210, 210]]);
    const flat = enhance(img, { saturation: 1, contrast: 0, sharpen: 0 });
    const sharp = enhance(img, { saturation: 1, contrast: 0, sharpen: 1 });
    const edgeFlat = flat.data[8] - flat.data[4];
    const edgeSharp = sharp.data[8] - sharp.data[4];
    assert.ok(edgeSharp > edgeFlat, `${edgeSharp} should exceed ${edgeFlat}`);
  },

  "sharpening preserves hue"() {
    const img = makeImage([[30, 15, 60], [200, 100, 40], [30, 15, 60]]);
    const out = enhance(img, { saturation: 1, contrast: 0, sharpen: 0.8 });
    const ratioBefore = img.data[4] / img.data[5];
    const ratioAfter = out.data[4] / out.data[5];
    assert.ok(Math.abs(ratioAfter - ratioBefore) < 0.05, `${ratioAfter} vs ${ratioBefore}`);
  },

  "alpha channel is never modified"() {
    const img = makeImage([[10, 20, 30, 128], [200, 100, 50, 255]]);
    const out = enhance(img, COVER_PRESET);
    assert.strictEqual(out.data[3], 128);
    assert.strictEqual(out.data[7], 255);
  },

  "source image is not mutated"() {
    const img = makeImage([[100, 50, 25]]);
    const copy = Uint8ClampedArray.from(img.data);
    enhance(img, COVER_PRESET);
    assert.deepStrictEqual(Array.from(img.data), Array.from(copy));
  },

  "missing options fall back to the cover preset"() {
    const img = makeImage([[140, 70, 35]]);
    assert.deepStrictEqual(
      Array.from(enhance(img, {}).data),
      Array.from(enhance(img, COVER_PRESET).data)
    );
  },

  "transparency detection"() {
    assert.strictEqual(hasTransparency(makeImage([[1, 2, 3, 255]])), false);
    assert.strictEqual(hasTransparency(makeImage([[1, 2, 3, 255], [4, 5, 6, 0]])), true);
  },

  "dimensions survive the round trip"() {
    const data = new Uint8ClampedArray(4 * 3 * 4).fill(120);
    const out = enhance(new ImageData(data, 4, 3), COVER_PRESET);
    assert.strictEqual(out.width, 4);
    assert.strictEqual(out.height, 3);
    assert.strictEqual(out.data.length, data.length);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
