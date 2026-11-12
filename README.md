# GPT 截图助手

ChatGPT 网页端的 Edge 截图插件。框选、标注后直接把图片放入对话输入框，不生成本地截图文件。

**1.1 Windows 新版：点击「隐藏本页后截图」，自动最小化 Edge，截取后面露出的画面，直接进入框选。无需选择屏幕或窗口。**

[下载最新版 ZIP](https://github.com/Han-Duuuuuu/gpt-capture/archive/refs/heads/main.zip)

## 安装

1. 下载并完整解压。升级时先在 `edge://extensions/` 移除 1.0 旧版。
2. 开启开发人员模式，加载含 `manifest.json` 的新版文件夹。
3. **首次启用免选择截图**：双击解压目录里的 `windows/install.cmd`，出现 `Installed successfully` 后关闭安装窗口。无需管理员权限。
4. 刷新 ChatGPT，使用页面上的相机悬浮按钮。

本机助手只安装一次，之后截图不再经过授权选择框。它仅在使用时由 Edge 启动，图片通过内存传回插件。Windows 10/11 自带的 .NET Framework 用于编译助手，无需 Python、Node.js 或常驻服务。

## 功能

- 截取当前可见网页。
- 隐藏 Edge 后，直接截取它所在屏幕露出的内容。
- 框选、整张、画框、箭头、画笔、颜色与撤销。
- 确认后加入 ChatGPT 附件区，保留草稿，不自动发送。
- 取消、关闭或失败后恢复原窗口。

默认取原 Edge 所在的一块显示器，跨屏时取占据面积最大的屏幕；隐藏的是整个 Edge 窗口。图片冻结后在工作台框选。免选择模式需要 Windows 助手，当前页模式不依赖助手。

完整安装、权限和卸载说明见 [使用说明](使用说明.md)，测试范围见 [验证记录](验证记录.md)。

## 验证

GitHub Actions 在 Windows 上编译助手，验证安装器和 Native Messaging 协议；Node 测试验证免选择截图顺序、数据分块及失败恢复。

```sh
node tests/native-client.test.mjs
node tests/background.test.mjs
```

Windows 本机可在独立 PowerShell 进程运行 `tests/verify-native.ps1`，它会安装测试助手、检查注册和协议，结束时卸载。此自动测试不代替真实 Edge、显示器和登录后 ChatGPT 的人工集成验证。
