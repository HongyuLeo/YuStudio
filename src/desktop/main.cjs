const {app, BrowserWindow, ipcMain, shell, dialog} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');
let server;
let win;
let language = 'zh-CN';
// Reuse the previous installation's profile when it exists. Media stays in
// place, and existing project files keep the same relative asset paths.
const yuProfile = app.getPath('userData');
const legacyProfile = path.join(app.getPath('appData'), 'nocturne-music-video-studio');
if (!require('node:fs').existsSync(path.join(yuProfile, 'studio')) && require('node:fs').existsSync(path.join(legacyProfile, 'studio'))) {
  app.setPath('userData', legacyProfile);
}
app.whenReady().then(async () => {
  process.env.NOCTURNE_ROOT = app.getAppPath();
  process.env.NOCTURNE_DATA = path.join(app.getPath('userData'), 'studio');
  process.env.NOCTURNE_DEMO = app.isPackaged ? path.join(process.resourcesPath, 'demo') : path.join(app.getAppPath(), 'public', 'demo');
  process.env.NODE_ENV = 'production';
  const languageFile = path.join(app.getPath('userData'), 'ui-language.json');
  language = await fs.readFile(languageFile, 'utf8').then(JSON.parse).then(value => value === 'en' ? 'en' : 'zh-CN').catch(() => 'zh-CN');
  const binaries = path.join(process.resourcesPath, 'binaries');
  if (app.isPackaged && require('node:fs').existsSync(path.join(binaries, 'remotion.exe'))) {
    process.env.REMOTION_BINARIES_DIRECTORY = binaries;
    process.env.FFMPEG_PATH = path.join(process.resourcesPath, 'media-tools', 'ffmpeg.exe');
    if (!require('node:fs').existsSync(process.env.FFMPEG_PATH)) throw new Error('完整 FFmpeg 组件缺失，请重新安装。 / Full FFmpeg is missing. Please reinstall.');
    process.env.FFPROBE_PATH = path.join(binaries, 'ffprobe.exe');
  }
  // Bundling and Chromium work out of a writable user directory, even in an installed app.
  const module = await import(pathToFileURL(path.join(app.getAppPath(), 'dist-server/index.mjs')).href);
  const started = await module.createStudioServer(0, true);
  server = started.server;
  win = new BrowserWindow({width: 1560, height: 1000, minWidth: 1080, minHeight: 720, backgroundColor: '#101314', title: 'YuStudio', icon:path.join(app.getAppPath(),'assets/icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  win.setMenuBarVisibility(false);
  const origin = `http://127.0.0.1:${started.port}`;
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', (e, url) => {if (!url.startsWith(origin + '/')) e.preventDefault();});
  ipcMain.handle('studio:get-language', () => language);
  ipcMain.handle('studio:set-language', async (_event, next) => {
    if (next !== 'zh-CN' && next !== 'en') throw new Error('Invalid language');
    language = next;
    await fs.mkdir(app.getPath('userData'), {recursive: true});
    await fs.writeFile(languageFile, JSON.stringify(language));
  });
  ipcMain.handle('studio:show-output', () => shell.openPath(path.join(process.env.NOCTURNE_DATA, 'exports')));
  ipcMain.handle('studio:save-project', async (_event, project) => {
    const r = await dialog.showSaveDialog(win, {defaultPath: 'project.json', filters: [{name: language === 'en' ? 'YuStudio Project' : 'YuStudio 项目', extensions: ['json']}]});
    if (r.canceled || !r.filePath) return {cancelled: true};
    await fs.writeFile(r.filePath, JSON.stringify(project, null, 2)); return {ok: true};
  });
  ipcMain.handle('studio:open-project', async () => {
    const r = await dialog.showOpenDialog(win, {properties: ['openFile'], filters: [{name: language === 'en' ? 'YuStudio Project' : 'YuStudio 项目', extensions: ['json']}]});
    return r.canceled ? null : JSON.parse(await fs.readFile(r.filePaths[0], 'utf8'));
  });
  win.webContents.session.on('will-download', (_event, item) => {
    const url = item.getURL();
    if (!url.startsWith(origin + '/')) item.cancel();
  });
  await win.loadURL(origin);
  if (process.env.YU_STUDIO_SMOKE_REPORT) {
    try {
      const report = await require('../testing/desktop-smoke.cjs')(win, origin, languageFile);
      await fs.writeFile(process.env.YU_STUDIO_SMOKE_REPORT, JSON.stringify(report, null, 2));
      app.quit();
    } catch (error) {
      await fs.writeFile(process.env.YU_STUDIO_SMOKE_REPORT, JSON.stringify({ok:false,error:error.stack || String(error)}));
      app.exit(1);
    }
  }
}).catch(e => {dialog.showErrorBox('YuStudio 启动失败 / Startup failed', e.stack || e.message); app.quit();});
app.on('window-all-closed', () => {server?.close(); app.quit();});
app.on('before-quit', () => {server?.close();});
