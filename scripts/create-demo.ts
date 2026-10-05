import fs from 'node:fs/promises';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';
import {newProject} from '../src/project/model';
import {runTool, importMedia, probe} from '../src/server/media';
import {safeAssetPath} from '../src/server/paths';
const dir = path.resolve('public/demo'); await fs.mkdir(dir, {recursive: true});
const palettes = [
  ['#172d40','#66848a','#bfc8bb','#233f4e','#102934','#081c25'],
  ['#0b2929','#67817a','#cad6b7','#355350','#153a38','#082524'],
  ['#271f3f','#777584','#e8c5b2','#3a344e','#221d34','#161326'],
  ['#132038','#647e9d','#c3d2da','#31485e','#172d43','#0b2031'],
  ['#5c4149','#c3927e','#f6d8ac','#936865','#634b58','#303343'],
];
function random(seed: number) {return () => {seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2 ** 32;};}
function scenery(i: number) {
  const p = palettes[i], rnd = random(901 + i), sunx = i === 1 ? 720 : i === 4 ? 1240 : 850;
  const stars = Array.from({length: 100}, () => `<circle cx="${rnd()*1920}" cy="${rnd()*570}" r="${.4+rnd()*1.3}" fill="#ecf0df" opacity="${.12+rnd()*.4}"/>`).join('');
  const hills = [
    'M0 540L180 464L355 530L540 345L697 472L845 407L1040 570L1240 430L1400 540L1620 373L1790 510L1920 463V1080H0Z',
    'M0 667L210 570L391 630L586 523L760 644L955 520L1167 640L1390 593L1570 645L1750 534L1920 603V1080H0Z',
    'M0 778C260 701 405 765 570 726S790 796 990 741S1280 711 1400 778S1670 725 1920 784V1080H0Z'
  ];
  let details = '';
  if (i === 0) for(let j=0;j<35;j++){const x=j*58+rnd()*25,y=680+rnd()*180,h=80+rnd()*130;details+=`<path d="M${x} ${y-h}l-${h*.27} ${h*.8}h${h*.18}l-${h*.32} ${h*.55}h${h*.92}l-${h*.32}-${h*.55}h${h*.18}z" fill="#0c2530" opacity=".5"/>`;}
  if (i === 1) for(let j=0;j<15;j++){const x=rnd()*1920,y=745+rnd()*310,r=20+rnd()*60;details+=`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*.19}" fill="#6a8270" opacity="${.08+rnd()*.08}"/><path d="M${x} ${y}q-16-23 4-47q24 20 0 47" fill="#ccaca7" opacity=".3"/>`;}
  if (i === 2) for(let j=0;j<46;j++){const x=j*45,y=535+rnd()*140,h=180+rnd()*180,w=25+rnd()*35;details+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#141423" opacity=".7"/>`;for(let k=0;k<5;k++)if(rnd()>.35)details+=`<rect x="${x+5}" y="${y+20+k*25}" width="2" height="8" fill="${k%2?'#a4c3d0':'#e3be90'}" opacity=".35"/>`;}
  const ripple = Array.from({length: 65}, (_,j) => {const y=730+j*5+rnd()*6,w=20+j*3+rnd()*120;return `<path d="M${sunx-w/2} ${y}h${w}" stroke="${p[2]}" stroke-width="${.7+j/40}" opacity="${.045+rnd()*.035}"/>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160" viewBox="0 0 1920 1080"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${p[0]}"/><stop offset=".67" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[5]}"/></linearGradient><radialGradient id="haze"><stop stop-color="${p[2]}" stop-opacity=".22"/><stop offset="1" stop-color="${p[1]}" stop-opacity="0"/></radialGradient><linearGradient id="water" x2="0" y2="1"><stop stop-color="${p[3]}"/><stop offset="1" stop-color="${p[5]}"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="35"/></filter><radialGradient id="edge"><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".26"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#sky)"/>${i<4?stars:''}<ellipse cx="${sunx}" cy="360" rx="620" ry="390" fill="url(#haze)"/><circle cx="${sunx}" cy="340" r="84" fill="${p[2]}" opacity=".045" filter="url(#soft)"/><circle cx="${sunx}" cy="340" r="${i===4?62:45}" fill="${p[2]}" opacity=".73"/>${hills.map((d,k)=>`<path d="${d}" fill="${p[k+3]}" opacity="${.6+k*.15}"/>`).join('')}<rect y="727" width="1920" height="353" fill="url(#water)" opacity=".91"/>${ripple}${details}<ellipse cx="970" cy="615" rx="1090" ry="90" fill="${p[1]}" opacity=".22" filter="url(#soft)"/><rect width="1920" height="1080" fill="url(#edge)"/></svg>`;
}
function ambientWav(i: number, seconds: number) {
  const rate = 48000, count = Math.floor(rate * seconds), pcm = Buffer.alloc(count * 4);
  const notes = [0,7,12,16,19,16,12,7,0,4,7,12,16,12,7,4];
  const base = [130.8128,146.8324,110,123.4708,164.8138][i];
  for(let n=0;n<count;n++){
    const t=n/rate, beat=Math.floor(t/.47), local=t%.47, freq=base*2**(notes[beat%notes.length]/12);
    const envelope=(1-Math.exp(-local*38))*Math.exp(-local*5);
    const pad=(Math.sin(2*Math.PI*base*t)+.55*Math.sin(2*Math.PI*base*1.5*t)+.3*Math.sin(2*Math.PI*base*2*t))*.055;
    const tone=(Math.sin(2*Math.PI*freq*t)+.22*Math.sin(2*Math.PI*freq*2*t))*envelope*.13;
    const fade=Math.min(1,t/.6,(seconds-t)/.8);
    for(let ch=0;ch<2;ch++){
      const space=.018*Math.sin(2*Math.PI*freq*(t-ch*.002))*(1-Math.exp(-local*12))*Math.exp(-local*3);
      const v=Math.max(-1,Math.min(1,(pad+tone+space)*fade));pcm.writeInt16LE(Math.round(v*32767),n*4+ch*2);
    }
  }
  const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(2,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*4,28);h.writeUInt16LE(4,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
const project = {...newProject(), id: 'nocturne-original-demo', name: '夜色，有回声。', subtitle: 'FIVE SCENES / ONE JOURNEY'};
project.render.resolution = '1080p'; project.render.concurrency = 2;
const titles=['雪落无声','荷塘微光','城市夜航','蓝色时刻','日落以后'];
for(let i=0;i<5;i++){
  const svg=path.join(dir,`scene-${i+1}.svg`), image=path.join(dir,`scene-${i+1}.png`), wav=path.join(dir,`track-${i+1}.wav`), audio=path.join(dir,`track-${i+1}.m4a`);
  await fs.writeFile(svg,scenery(i));
  await fs.writeFile(image,new Resvg(scenery(i)).render().asPng());
  await fs.writeFile(wav,ambientWav(i,7));
  await runTool('ffmpeg',['-y','-v','error','-i',wav,'-c:a','aac','-b:a','256k','-ar','48000','-metadata',`title=${titles[i]}`,'-metadata','artist=YuStudio Original',audio]);
  const duration=Number((await probe(audio)).format.duration);
  let background: {src:string;name:string;kind:'image'|'video';width:number;height:number;duration?:number;thumbnail?:string;loopPrepared?:boolean}={src:`demo/scene-${i+1}.png`,name:`scene-${i+1}.png`,kind:'image',width:3840,height:2160};
  if(i===2){
    const raw=path.join(dir,'city-raw.mp4');
    await runTool('ffmpeg',['-y','-v','error','-i',image,'-vf',"zoompan=z='1.03+0.007*sin(on/30)':x='iw/2-iw/zoom/2+8*sin(on/22)':y='ih/2-ih/zoom/2':d=90:s=1920x1080:fps=30",'-t','3','-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',raw]);
    const prepared=await importMedia(raw,'city.mp4','background');
    await fs.copyFile(safeAssetPath(prepared.asset.src),path.join(dir,'city-loop.mp4'));
    await fs.copyFile(safeAssetPath(prepared.asset.thumbnail!),path.join(dir,'city-thumb.jpg'));
    background={...prepared.asset,kind:'video',src:'demo/city-loop.mp4',thumbnail:'demo/city-thumb.jpg',width:1920,height:1080};
    await fs.rm(raw,{force:true});await fs.rm(safeAssetPath(prepared.asset.src),{force:true});await fs.rm(safeAssetPath(prepared.asset.thumbnail!),{force:true});
  }
  project.tracks.push({id:`demo-track-${i+1}`,title:titles[i],artist:'YuStudio Original',audio:{kind:'audio',src:`demo/track-${i+1}.m4a`,name:`track-${i+1}.m4a`,duration},background,focus:{x:[.44,.38,.47,.46,.65][i],y:.48},atmosphere:{preset:(['snow','fireflies','embers','fireflies','embers'] as const)[i],amount:.75}});
  console.log(`Demo ${i+1}/5: ${titles[i]} (${duration}s)`);
}
await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(project,null,2));
await fs.writeFile(path.join(dir,'LICENSE.txt'),'All demonstration SVGs, raster backgrounds, video loops and synthesized audio in this directory were created programmatically for YuStudio. They are dedicated to the public domain under CC0 1.0 Universal. No commercial songs or third-party photographs are included.\n');
console.log('Demo ready.');
