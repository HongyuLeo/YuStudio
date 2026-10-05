// Bake the original CSS effects in Chromium once. PNGs and layout metadata are
// checked in; users do not need Playwright or texture generation to run/build.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ensureBrowser} from '@remotion/renderer';
const require = createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const status=(process.env.REMOTION_BROWSER_EXECUTABLE?{path:process.env.REMOTION_BROWSER_EXECUTABLE}:await ensureBrowser({logLevel:'warn'}));if (!('path' in status)) throw Error('Browser unavailable');
const browser=await chromium.launch({executablePath:status.path,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({deviceScaleFactor:2});
const output=path.resolve('public/atmosphere');await fs.mkdir(output,{recursive:true});
const seed=(i:number,salt:number)=>{const n=Math.sin(i*127.1+salt*311.7)*43758.5453;return n-Math.floor(n);};
const particles=([0,1,2] as const).flatMap(depth=>Array.from({length:depth===0?30:depth===1?32:10},(_,i)=>{
 const id=depth*100+i,size=(depth===0?1.5:depth===1?3.2:12)*(.55+seed(id,1)*1.5);
 const cell=depth===0?32:depth===1?64:256,offset=depth===0?0:depth===1?32:160;
 const cols=1024/cell;return {id,depth,size,cell,sx:(i%cols)*cell,sy:offset+Math.floor(i/cols)*cell};
}));
const bokeh=Array.from({length:5},(_,i)=>({id:i,size:45+seed(i,20)*80,cell:208,sx:(i%4)*208,sy:928+Math.floor(i/4)*208}));
const atlas={width:1024,height:1344,particles,bokeh};
try {
 for (const preset of ['snow','embers','fireflies']) {
  const warm=preset==='embers',snow=preset==='snow',color=warm?'#ffbf72':snow?'#edf5ff':'#c8e8ac';
  const particleHtml=particles.map(p=>`<div style="position:absolute;left:${p.sx+(p.cell-p.size)/2}px;top:${p.sy+(p.cell-p.size*(warm?1.55:1))/2}px;width:${p.size}px;height:${p.size*(warm?1.55:1)}px;border-radius:${warm?'65% 30% 55% 40%':'50%'};background:${color};filter:blur(${p.depth===0?.2:p.depth===1?.4:3.5}px);box-shadow:${snow?'none':`0 0 ${p.size*3}px ${color}90, 0 0 ${p.size}px ${color}`}" ></div>`).join('');
  const bokehHtml=bokeh.map(p=>`<div style="position:absolute;left:${p.sx+(p.cell-p.size)/2}px;top:${p.sy+(p.cell-p.size)/2}px;width:${p.size}px;height:${p.size}px;border-radius:50%;background:radial-gradient(circle,${color}45,${color}16 44%,transparent 70%);filter:blur(9px)"></div>`).join('');
  await page.setViewportSize({width:atlas.width,height:atlas.height});
  await page.setContent(`<html><body style="margin:0;background:transparent">${particleHtml}${bokehHtml}</body></html>`);
  await page.screenshot({path:path.join(output,`${preset}-sprites.png`),omitBackground:true});
  for (const orientation of ['landscape','portrait']) {
   const w=orientation==='landscape'?1920:1080,h=orientation==='landscape'?1080:1920;
   for (const kind of ['mist','beam']) {
    const width=kind==='mist'?w*1.35:w*.66,height=kind==='mist'?h*.72:h*1.3,pad=kind==='mist'?128:88;
    const background=kind==='mist'?`radial-gradient(ellipse at 30% 52%,${color}20,transparent 52%),radial-gradient(ellipse at 76% 38%,#c5d5ec14,transparent 48%)`:`linear-gradient(90deg,transparent 22%,${color}12 32%,transparent 42%,${color}0b 58%,transparent 68%)`;
    await page.setViewportSize({width:Math.ceil(width+pad*2),height:Math.ceil(height+pad*2)});
    await page.setContent(`<html><body style="margin:0;background:transparent"><div style="position:absolute;left:${pad}px;top:${pad}px;width:${width}px;height:${height}px;background:${background};filter:blur(${kind==='mist'?32:22}px)"></div></body></html>`);
    await page.screenshot({path:path.join(output,`${preset}-${orientation}-${kind}.png`),omitBackground:true});
   }
  }
 }
 await fs.writeFile('src/components/atmosphere-atlas.json',JSON.stringify(atlas,null,2)+'\n');
 console.log('Baked 15 original CSS textures at 2x, including all 72 particle shapes and 5 bokeh lights per preset.');
} finally {await browser.close();}
