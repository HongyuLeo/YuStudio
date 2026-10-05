import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newProject, projectSchema, validateForRender, type Track} from '../src/project/model';
import {timeline, totalFrames, cueAt, chapters, coverPosition, playlistWindow} from '../src/timeline';
function track(i: number, duration = 1.0123): Track {return {id:`t-${i}`,title:`歌曲 ${i}`,artist:'测试',audio:{kind:'audio',name:'test.wav',src:'assets/test.wav',duration},background:{kind:'image',name:'test.png',src:'assets/test.png',width:1920,height:1080},focus:{x:.35,y:.48}};}
test('cumulative timeline has contiguous cues and no rounding drift across 100 songs', () => {
  const p={...newProject(),tracks:Array.from({length:100},(_,i)=>track(i))};
  const cues=timeline(p);assert.equal(totalFrames(p),Math.round(100*1.0123*p.fps));
  for(let i=1;i<cues.length;i++)assert.equal(cues[i-1].end,cues[i].start);
  assert.equal(cueAt(cues,cues[1].start)?.index,1);assert.equal(cueAt(cues,cues[1].start-1)?.index,0);
});
test('focus point centers subject in portrait and clamps at edges',()=>{
  const c=coverPosition(1920,1080,1080,1920,.35,.48);
  assert.ok(Math.abs(c.left+c.width*.35-540)<.001);
  const edge=coverPosition(1920,1080,1080,1920,0,0);
  assert.equal(edge.left,0);assert.equal(edge.top,0);
  const other=coverPosition(1920,1080,1080,1920,1,1);
  assert.equal(other.left,1080-other.width);assert.equal(other.top,1920-other.height);
});
test('chapter timestamps match actual frame-boundary cue starts',()=>{
  const p={...newProject(),tracks:[track(0,252),track(1,289),track(2,12)]};
  assert.equal(chapters(p),'00:00 歌曲 0 — 测试\n04:12 歌曲 1 — 测试\n09:01 歌曲 2 — 测试\n');
});
test('long playlist scrolls to active track without out of bounds windows',()=>{
  for(let i=0;i<80;i++){const w=playlistWindow(i,80,5);assert.ok(w>=0&&w<=75);assert.ok(i>=w&&i<w+5);}
});
test('render validation rejects missing backgrounds and malformed imported projects',()=>{
  assert.throws(()=>validateForRender(newProject()),/导入/);
  const t=track(1);delete t.background;assert.throws(()=>validateForRender({...newProject(),tracks:[t]}),/背景/);
  assert.throws(()=>projectSchema.parse({...newProject(),tracks:[track(0),track(0)]}),/重复/);
  assert.throws(()=>projectSchema.parse({...newProject(),tracks:[{...track(0),focus:{x:1.5,y:.5}}]}));
});
