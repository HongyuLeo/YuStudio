const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
(async()=>{
 const executable=path.resolve('release/win-unpacked/YuStudio.exe');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'yustudio-smoke-'));
 const report=path.join(folder,'report.json');
 const child=spawn(executable,[],{env:{...process.env,YU_STUDIO_SMOKE_REPORT:report},stdio:'inherit'});
 const timer=setTimeout(()=>{child.kill();console.error('Desktop smoke test timed out');process.exit(1);},90000);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timer);
 if(code!==0 || !fs.existsSync(report))throw Error('Desktop smoke test failed: '+code);
 const result=JSON.parse(fs.readFileSync(report,'utf8'));console.log(JSON.stringify(result,null,2));
 if(!result.ok)throw Error(result.error || 'Desktop smoke test failed');
 fs.writeFileSync('release/windows-smoke.json',JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
