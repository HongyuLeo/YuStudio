# YuStudio 1.3.0 verification / 验证说明

## Verified results · 2026-10-05 / 实测结果

- Linux: 26 tests passed. Windows CI: 25 passed, 1 skipped (the Unix executable stand-in used for NVENC argument capture).
- The packaged `YuStudio.exe` started on the Windows CI runner. Both languages, persisted language preference, all five demo tracks, API health and bundled FFmpeg/FFprobe passed.
- A real 2.4-second, two-song image/video export completed in both orientations: 1920×1080 and 1080×1920, 30 FPS, 72 video frames each, AAC at 48 kHz. English progress messages were checked during preparation and rendering.
- Chinese/English introduction-page switching, remembered language and a 390-pixel mobile layout passed. Chinese fonts are hosted with the site.
- Both GitHub Release ZIPs were actually downloaded and passed SHA-256 and full ZIP CRC validation. Windows ZIP: 312,467,715 bytes; source ZIP: 10,769,614 bytes.

Linux 26 项测试通过；Windows 25 项通过、1 项跳过。Windows 包实际启动并验证双语、语言记忆、演示和内置组件。横竖屏实际短片导出、英文进度、介绍页切换及手机排版通过。两个正式下载包均已实际下载并通过 SHA-256 与 ZIP 完整性检查。

## Automated checks / 自动检查

- 26 tests cover timeline/layout dimensions, project validation, media imports, video loops, frame caching/cancellation, NVENC arguments and probes, throughput diagnostics, concurrency selection and translation completeness.
- The production build runs TypeScript checking, Vite bundling and Remotion bundling.
- Browser UI checks cover Chinese and English labels, live switching, remembered language after reload, localized new-project naming and absence of runtime errors.
- The Windows release workflow runs Windows tests and opens the actual packaged YuStudio desktop. Its smoke check verifies both languages, saved language preference, demo loading, local service health and executable FFmpeg/FFprobe components.

## Export behavior / 输出行为

The branding/language update leaves the scene composition, camera movement, original brightness, particles, transitions, blank-artist handling, video reader and encoding settings intact. UI language is outside the project schema and is not injected into the rendered composition.

本次改名与双语更新保留原有场景、镜头、亮度、粒子、转场、空歌手隐藏、背景读取与编码设置。界面语言独立于项目，不传入渲染构图。

## Scope / 范围

The local development environment uses Linux with software graphics, not an NVIDIA GPU. Windows CI validates packaging and desktop startup; it does not validate RTX 4090 drivers or promise any speed increase. The 1.3.0 update adds branding, language and distribution support; it does not introduce a new rendering architecture.

本地验证环境为 Linux 软件绘图。Windows CI 验证构建和桌面启动，不验证 RTX 4090 驱动，也不承诺性能提升。1.3.0 是改名、双语与发布更新，渲染架构保持不变。

The initial Chromium download requires a network connection. Exports have no resume-after-reboot support. Source archives require a build before starting production mode. The Windows ZIP has no commercial code signature.

首次 Chromium 准备需要网络。导出不支持重启后的断点续传。源码启动生产模式前需要构建。Windows ZIP 未使用商业代码签名。

## 1.3.1 branding correction / 品牌显示修正

- Replaced the text logo with a centered, symmetrical SVG Y; regenerated PNG/ICO icons and both editor screenshots.
- Chinese and English introduction pages, READMEs and release notes use YuStudio consistently.
- Local: 26 tests passed; production build passed; real Electron window loaded five demo tracks and switched both UI languages.
- Scene composition, media readers and encoding behavior remain unchanged.

界面、程序图标和介绍页截图使用端正居中的矢量 Y；中英文文案统一使用 YuStudio。26 项本地测试与生产构建通过，Electron 实际界面加载并切换双语。
