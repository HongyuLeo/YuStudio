import path from 'node:path';
import {bundle} from '@remotion/bundler';
await bundle({entryPoint:path.resolve('src/compositions/Root.tsx'),outDir:path.resolve('remotion-dist'),publicDir:path.resolve('public')});
console.log('Production motion compositions bundled.');
