// Invoked only by the Windows release smoke test; operates on our own window.
module.exports = async (win, origin, languageFile) => {
  const wait = async (code) => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await win.webContents.executeJavaScript(code)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Desktop UI timed out: ' + code);
  };
  await wait(`document.querySelector('.track-list .track-card') !== null`);
  const initialTitle = await win.webContents.executeJavaScript('document.title');
  if (!initialTitle.startsWith('YuStudio')) throw new Error('Incorrect window branding');
  const switchLanguage = async language => {
    await win.webContents.executeJavaScript(`(() => {const select=document.querySelector('.language-switch');select.value=${JSON.stringify(language)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`document.documentElement.lang === ${JSON.stringify(language)}`);
  };
  await switchLanguage('en');
  await wait(`document.body.innerText.includes('Create music video') && document.body.innerText.includes('Measure fastest concurrency')`);
  const saved = await win.webContents.executeJavaScript(`window.studio.getLanguage()`);
  if (saved !== 'en') throw new Error('English preference was not persisted');
  await switchLanguage('zh-CN');
  await wait(`document.body.innerText.includes('生成音乐影像') && document.body.innerText.includes('实测最快并发')`);
  const health = await fetch(origin + '/api/health').then(response => response.json());
  if (!health.ok || health.version !== '1.3.1') throw new Error('Local service health failed');
  const {execFileSync} = require('node:child_process');
  const ffmpeg = execFileSync(process.env.FFMPEG_PATH, ['-version'], {encoding:'utf8',windowsHide:true});
  const ffprobe = execFileSync(process.env.FFPROBE_PATH, ['-version'], {encoding:'utf8',windowsHide:true});
  return {ok:true,version:health.version,title:initialTitle,languages:['zh-CN','en'],preferencePersisted:saved==='en',demoTracks:5,ffmpeg:ffmpeg.split('\n')[0],ffprobe:ffprobe.split('\n')[0]};
};
