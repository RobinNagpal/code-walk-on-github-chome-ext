// Layer 1: reading walkthrough zips, without VS Code.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { zipSync, type Zippable } from 'fflate';
import { unpackWalkthrough } from '../../src/core/zip.ts';
import { WALKTHROUGHS_DIR } from './fixtures.ts';

const encode = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

function walkthrough(id = 'demo-tour') {
  return {
    version: 1,
    id,
    title: 'Demo tour',
    repo: { owner: 'octo', name: 'demo', commit: 'a'.repeat(40) },
    slides: [
      { id: '01-start', title: 'Start', summary: 's', narration: 'one two three', file: 'src/a.ts', lines: { start: 1, end: 3 }, audio: '01-start.mp3' },
      { id: '02-end', title: 'End', summary: 's', narration: 'four five', audio: '02-end.mp3' },
    ],
  };
}

const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

describe('unpackWalkthrough', () => {
  it('reads a zip with one folder, as the skill writes it', () => {
    const zip = zipSync({ 'demo-tour': { 'walkthrough.json': encode(walkthrough()), '01-start.mp3': mp3, '02-end.mp3': mp3 } });
    const unpacked = unpackWalkthrough(zip);
    assert.equal(unpacked.walkthrough.id, 'demo-tour');
    assert.deepEqual([...unpacked.files.keys()].sort(), ['01-start.mp3', '02-end.mp3', 'walkthrough.json']);
    assert.deepEqual(unpacked.missingAudio, []);
  });

  it('reads a zip with the files at its top level', () => {
    const zip = zipSync({ 'walkthrough.json': encode(walkthrough()), '01-start.mp3': mp3 });
    const unpacked = unpackWalkthrough(zip);
    assert.equal(unpacked.walkthrough.slides.length, 2);
    assert.deepEqual(unpacked.missingAudio, ['02-end.mp3']);
  });

  it('keeps only plain file names from the walkthrough folder', () => {
    const files: Zippable = {
      'demo-tour': { 'walkthrough.json': encode(walkthrough()), '01-start.mp3': mp3, nested: { 'x.mp3': mp3 } },
      'other-folder': { 'y.mp3': mp3 },
    };
    const unpacked = unpackWalkthrough(zipSync(files));
    assert.deepEqual([...unpacked.files.keys()].sort(), ['01-start.mp3', 'walkthrough.json']);
  });

  it('rejects files that are not walkthroughs, with a readable reason', () => {
    assert.throws(() => unpackWalkthrough(encode('not a zip')), /not a valid zip/);
    assert.throws(() => unpackWalkthrough(zipSync({ 'readme.txt': encode('hi') })), /no walkthrough\.json/);
    assert.throws(
      () => unpackWalkthrough(zipSync({ a: { 'walkthrough.json': encode(walkthrough()) }, b: { 'walkthrough.json': encode(walkthrough()) } })),
      /2 walkthroughs/,
    );
    assert.throws(() => unpackWalkthrough(zipSync({ 'walkthrough.json': encode('{oops') })), /not valid JSON/);
    assert.throws(() => unpackWalkthrough(zipSync({ 'walkthrough.json': encode({ version: 1 }) })), /missing id or title/);
    assert.throws(() => unpackWalkthrough(zipSync({ 'walkthrough.json': encode(walkthrough('../escape')) })), /can't be used in a folder name/);
  });

  for (const id of ['robotics-basics-pr-6-frames-3d-and-motion', 'clear-the-table-solution-1-one-fixed-nudge']) {
    const path = join(WALKTHROUGHS_DIR, `${id}.zip`);
    it(`reads the skill's zip for ${id}`, { skip: !existsSync(path) && `${path} not found` }, () => {
      const unpacked = unpackWalkthrough(readFileSync(path));
      assert.equal(unpacked.walkthrough.id, id);
      assert.deepEqual(unpacked.missingAudio, []);
      for (const slide of unpacked.walkthrough.slides) assert.ok(unpacked.files.get(slide.audio!)!.length > 1000, `${slide.audio} is in the zip`);
    });
  }
});
