const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const version=require('../package.json').version;
const dest=path.resolve('release/YuStudio-Source.zip');
fs.mkdirSync('release',{recursive:true});
execFileSync('git',['archive','--format=zip','--prefix=YuStudio/','-o',dest,'HEAD'],{stdio:'inherit'});
console.log('Source archive ready:',version,dest);
