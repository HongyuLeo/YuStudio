# YuStudio 1.3.0 verification / 验证说明

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
