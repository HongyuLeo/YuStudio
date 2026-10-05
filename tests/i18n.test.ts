import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {messages, messagePatterns, translateText} from '../src/i18n/messages';

test('every static Chinese editor label and notification has an English translation', () => {
  for (const file of ['src/App.tsx', 'src/components/PerformanceControls.tsx']) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && node.text !== 'Language / 语言' && /\p{Script=Han}/u.test(node.text)) assert.ok(messages[node.text], `${file}: ${node.text}`);
      if (ts.isJsxText(node)) assert.ok(node.text.trim() === '中文' || !/\p{Script=Han}/u.test(node.text), `Unlocalized JSX: ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

test('dynamic import, cache, benchmark and export messages are translated without changing media names', () => {
  assert.equal(translateText('准备「雪花：测试视频.mp4」无损帧缓存 24/90 帧', 'en'), 'Preparing “雪花：测试视频.mp4” lossless frame cache 24/90 frames');
  assert.equal(translateText('本机测速 横屏 · 32 并发 · 场景 1/2 · 90/128 帧…', 'en'), 'Measuring landscape · 32 workers · Scene 1/2 · 90/128 frames…');
  assert.equal(translateText('渲染竖屏影像…（实测选择 8 并发）', 'en'), 'Rendering portrait video… (8 measured workers)');
  assert.equal(translateText('强制 NVIDIA NVENC 初始化失败，本次生成已停止。\n[h264_nvenc] error\n中文文件.mp4', 'en'), 'Required NVIDIA NVENC initialization failed. This export has stopped.\n[h264_nvenc] error\n中文文件.mp4');
  assert.equal(translateText('雪落无声.mp4', 'en'), '雪落无声.mp4');
  assert.equal(translateText('导出完成', 'zh-CN'), '导出完成');
});

test('every dynamic translation preserves its parameter count', () => {
  for (const [source, target] of messagePatterns) {
    const parameters = (value: string) => [...value.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(parameters(target), parameters(source), source);
    const sample = source.replace(/\{(\d+)\}/g, (_, index) => `sample${index}`);
    assert.equal(translateText(sample, 'en'), target.replace(/\{(\d+)\}/g, (_, index) => `sample${index}`));
  }
});
