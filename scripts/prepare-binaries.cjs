const fs = require('node:fs');
const path = require('node:path');
const dest = path.resolve('.desktop-binaries');
if (process.platform === 'win32') {
  const pkg = require.resolve('@remotion/compositor-win32-x64-msvc/package.json');
  fs.cpSync(path.dirname(pkg), dest, {recursive:true});
}
for (const binary of ['remotion.exe','ffmpeg.exe','ffprobe.exe']) {
  const file = path.join(dest,binary);
  if (!fs.existsSync(file) || fs.readFileSync(file).subarray(0,2).toString() !== 'MZ') throw new Error('Windows rendering binaries are missing. Run this build on Windows with npm ci.');
}
if (process.platform === 'win32') {
  fs.mkdirSync('.desktop-media', {recursive:true});
  fs.copyFileSync(require('ffmpeg-static'), path.resolve('.desktop-media/ffmpeg.exe'));
}
if (!fs.existsSync('.desktop-media/ffmpeg.exe')) throw new Error('Full Windows FFmpeg is missing.');
console.log('Windows native rendering binaries ready.');
