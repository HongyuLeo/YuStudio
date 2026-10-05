import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {projectSchema} from '../project/model';
import {importMedia, createTrack} from './media';
import {assetsRoot, outputRoot, projectsRoot, dataRoot, root} from './paths';
import {startRender, jobs, cancelJob, verifyAssets,isRenderActive} from '../renderer/pipeline';
import {machineInfo} from '../renderer/performance';
import {frameCacheRoot} from '../renderer/frame-cache';

export async function createStudioServer(port = Number(process.env.PORT || 4317), production = process.env.NODE_ENV === 'production') {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return res.status(403).json({error: '只能在本机使用。'});
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && req.headers.origin !== `http://${host}`) return res.status(403).json({error: '跨站请求已拒绝。'});
    next();
  });
  app.use(express.json({limit: '8mb'}));
  const tempRoot = path.join(dataRoot, 'tmp'); await fs.mkdir(tempRoot, {recursive: true});
  const upload = multer({dest: tempRoot, limits: {fileSize: 2 * 1024 ** 3, files: 100}});
  // The composition is served on another loopback port. WebCodecs fetches
  // media bytes (including range requests), rather than loading an <img>.
  const localMediaCors:express.RequestHandler=(req,res,next)=>{
    const origin=req.headers.origin;
    if(origin && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Access-Control-Expose-Headers','Content-Range, Accept-Ranges, Content-Length');
      res.vary('Origin');
    }
    next();
  };
  app.use('/media', localMediaCors, express.static(assetsRoot, {fallthrough: false, maxAge: '1y', immutable: true}));
  app.use('/demo', localMediaCors, express.static(process.env.NOCTURNE_DEMO || path.join(root, 'public/demo')));
  app.use('/frames',localMediaCors,express.static(frameCacheRoot,{fallthrough:false,maxAge:'1y',immutable:true,dotfiles:'deny'}));
  app.use('/exports', express.static(outputRoot, {fallthrough: false, setHeaders: (res, file) => {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
  }}));
  app.get('/api/health', (_req, res) => res.json({ok: true, version: '1.3.1', outputFolder: outputRoot}));
  app.get('/api/performance', (_req, res) => res.json(machineInfo()));
  app.get('/api/frame-cache',async(_req,res)=>{
    const folders=await fs.readdir(frameCacheRoot).catch(()=>[]);let bytes=0,backgrounds=0;
    for(const name of folders.filter(n=>/^[a-f0-9]{64}$/.test(n))){const ready=await fs.readFile(path.join(frameCacheRoot,name,'ready.json'),'utf8').then(JSON.parse).catch(()=>null);if(ready){bytes+=ready.bytes||0;backgrounds++;}}
    res.json({bytes,backgrounds});
  });
  app.post('/api/frame-cache/clear',async(_req,res)=>{
    if(isRenderActive())return res.status(409).json({error:'请等待当前生成任务结束，再清理背景缓存。'});
    await fs.rm(frameCacheRoot,{recursive:true,force:true});res.json({bytes:0,backgrounds:0});
  });
  app.post('/api/import', upload.array('files', 100), async (req, res) => {
    const files = req.files as Express.Multer.File[] ?? [];
    const kind = req.body.kind === 'audio' ? 'audio' : 'background';
    if (!files.length) return res.status(400).json({error: '没有选择文件。'});
    const results = [];
    for (const file of files) {
      // Browser FormData uses UTF-8 but busboy decodes multipart filenames as Latin-1.
      const name = /[\u0080-\u00ff]/.test(file.originalname) ? Buffer.from(file.originalname, 'latin1').toString('utf8') : file.originalname;
      try {
        const media = await importMedia(file.path, name, kind);
        results.push({name, ...media, track: kind === 'audio' ? createTrack(media.asset, media.title!, media.artist!) : undefined});
      } catch (e) {results.push({name, error: e instanceof Error ? e.message : String(e)});}
      finally {await fs.rm(file.path, {force: true});}
    }
    res.json({results});
  });
  app.post('/api/project/save', async (req, res) => {
    const project = projectSchema.parse(req.body);
    await verifyAssets(project);
    const name = `${project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    const target = path.join(projectsRoot, name), temp = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(project, null, 2)); await fs.rename(temp, target);
    res.json({ok: true, url: `/api/project/download/${encodeURIComponent(name)}`});
  });
  app.get('/api/project/download/:name', (req, res) => {
    const name = req.params.name;
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) return res.sendStatus(400);
    res.download(path.join(projectsRoot, name), 'project.json', {dotfiles: 'allow'});
  });
  app.post('/api/project/open', async (req, res) => {
    const project = projectSchema.parse(req.body);
    await verifyAssets(project);
    res.json({project});
  });
  app.get('/api/demo', async (_req, res) => {
    const demoPath = path.join(process.env.NOCTURNE_DEMO || path.join(root, 'public/demo'), 'project.json');
    res.json(JSON.parse(await fs.readFile(demoPath, 'utf8')));
  });
  app.post('/api/render', async (req, res) => {
    const project = projectSchema.parse(req.body);
    const job = await startRender(project, `http://${req.headers.host}`);
    res.json(job);
  });
  app.get('/api/render/:id/diagnostics', (req, res) => {
    const job=jobs.get(req.params.id);
    if(!job)return res.status(404).json({error:'找不到此导出任务。'});
    res.attachment('YuStudio-diagnostics.json').json({state:job.state,message:job.message,performance:job.performance,...job.diagnostics});
  });
  app.get('/api/render/:id', (req, res) => {
    const job = jobs.get(req.params.id); if (!job) return res.status(404).json({error: '没有找到此导出任务。'});
    res.json(job);
  });
  app.post('/api/render/:id/cancel', (req, res) => {cancelJob(req.params.id); res.json({ok: true});});
  if (production) {
    app.use(express.static(path.join(root, 'dist')));
    app.get('/{*any}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
  } else {
    const {createServer} = await import('vite');
    const vite = await createServer({root, server: {middlewareMode: true, hmr: {port: 4318}}, appType: 'spa'});
    app.use(vite.middlewares);
  }
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    if (!res.headersSent) res.status(400).json({error: msg});
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s)); s.on('error', reject);
  });
  return {server, port: (server.address() as {port: number}).port};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createStudioServer().then(({port}) => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`YuStudio → ${url}`);
    if (process.env.NOCTURNE_OPEN_BROWSER === '1') {
      const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const child = spawn(command, args, {detached: true, stdio: 'ignore', windowsHide: true});
      child.on('error', () => console.log(`请在浏览器中打开 ${url}`)); child.unref();
    }
  }).catch(e => {console.error(e); process.exitCode = 1;});
}
