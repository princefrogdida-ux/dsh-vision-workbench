# dsh-vision-workbench

面向 Windows、默认不接管官方模型路由的 DeepSeek Harness 视觉工具插件。

当前 `0.7.1` 已完成阶段 0～6：除图片准入包装路由和 `vision_describe` 外，还提供 Windows 本地像素处理、可选离线 OCR、安全网页截图闭环、有界的多视觉 Provider 自动回退，以及 DeepSeek Harness 原生可视化配置卡片。DeepSeek 继续负责推理；只有远程视觉工具调用才会把图片发送给用户明确配置的 OpenAI-compatible 视觉模型。

## 当前能力

- 上传 PNG、JPEG、WebP 后，包装路由把持久化附件投影成带附件 ID 的文本标记。
- `vision_describe` 支持 1～4 张上传图片或工作区图片。
- 支持普通图片问答、多图比较和结构化截图证据。
- 工具结果作为规范 JSON 值写入会话，因此重新打开会话仍可回放。
- 有界附件索引、字节/像素限制、超时、LRU/TTL 缓存和一次 429 重试。
- API Key 通过 `ctx.credentials` 引用读取；不写入配置或日志。
- 可选代理按本插件请求配置，不修改 `globalThis.fetch`。
- `vision_crop` 按像素坐标裁剪，并把派生 PNG 保存为持久附件。
- `vision_compare` 对同尺寸截图进行确定性像素比较，返回变化比例和洋红色差异图。
- `vision_palette` 在本地提取稳定的近似主色。
- `vision_ocr` 默认使用已配置视觉 Provider，也可显式选择 `backend="local"`，通过本地 Tesseract.js 转录文字；两种后端都可先裁剪指定区域。
- 本地 OCR 只读取明确配置的绝对语言数据目录，关闭缓存写入和运行时下载，单 Worker 串行复用并在插件卸载时终止。
- Sharp 为惰性加载的可选后端；缺失时远程 `vision_describe` 和非区域 OCR 仍可使用。
- `vision_browser_capture` 在全新无头 Edge/Chrome 临时上下文中打开明确白名单 URL，并把 PNG 保存为持久附件。
- 网页导航、重定向、子资源和 WebSocket 共用精确主机白名单；默认拒绝本机、局域网和云元数据地址。
- 支持一个主视觉 Provider 和最多三个有序后备 Provider；单次失败会分类、回退，并通过短路冷却避免持续轰击故障端点。
- 描述和 OCR 结果持久记录实际 Provider、模型、尝试次数以及是否使用后备，不把端点错误正文或凭据写入结果。
- 在“设置 → 插件 → 插件配置”中点击 `Vision Workbench`，可直接编辑全部配置字段；每个视觉 Provider 都有独立的写入式 API Key 密码框。
- API Key 只进入 Harness Credentials；配置界面只读取“已配置/未配置”和可写状态，永不回显密钥。

## 明确不做

- 不禁用或接管 `deepseek-official`。
- 不内置匿名免费视觉端点。
- 不修改全局附件限制。
- 不自动缩放或对齐待比较截图；尺寸不一致会明确失败。
- 不捆绑 Tesseract 语言数据，不自动下载语言包，也不包含 SVG 描摹或前景抠除。
- 不接管用户已打开的 Edge/Chrome，不复用登录态，不点击、输入、提交表单或下载文件。
- 不支持 GIF；请先转换为 PNG、JPEG 或 WebP。

## 兼容基线

- DeepSeek Harness `0.1.0-rc.5`
- Node `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`

Harness 框架包声明为宿主提供的 peer dependencies，避免插件安装第二份 Cordis/服务运行时。由于 npm 未发布
`dsh-llm@0.1.0-rc.5` 等完整 rc.5 包组，本地开发使用 rc.6 包做编译和纯模拟测试；最终兼容性仍以本机 rc.5
源码审查和独立 Profile 加载测试为准，绝不把 rc.6 实现打入插件包。

## 安全安装流程

Bundle 安装后默认保持 `enabled: false`，不会注册远程视觉能力。开发和验证应使用独立 Profile，例如 `vision-lab`，不要直接修改主 Profile。

推荐使用原生可视化配置：

1. 启动已安装本插件的 Web Profile。
2. 打开“设置 → 插件 → 插件配置”。
3. 点击 `Vision Workbench` 展开完整表单。
4. 填写视觉模型的 Base URL、模型名、凭据引用名和 API Key；按需调整 OCR、浏览器截图、缓存、代理等高级选项。
5. 点击“保存配置”，然后重启当前 Profile。插件的设置命名空间声明为 `restart`，避免正在执行的视觉任务被中途换路由或释放资源。

密码框留空表示保留现有密钥。保存的 API Key 不进入 Settings 文档、`cordis.patch.yml`、日志或页面响应；界面刷新后密码框仍为空，只显示“已配置”。

以下 YAML 仅作为无 Web UI 或自动化部署时的备用方式：

在独立 Profile 的后置 Patch 中完整覆盖配置：

```yaml
- id: vision-workbench
  name: dsh-vision-workbench
  config:
    enabled: true
    wrapperRoute: deepseek-vision-workbench
    textProvider:
      provider: deepseek-official
      model: deepseek-v4-pro
    visionProvider:
      name: primary
      baseURL: https://your-provider.example/v1
      model: your-vision-model
      credentialRef: VISION_API_KEY
      allowKeyless: false
      allowInsecureLocalhost: false
      maxTokens: 4096
    fallbackProviders: []
    providerRouting:
      attemptTimeoutMs: 45000
      failureThreshold: 2
      cooldownSeconds: 60
    limits:
      maxImagesPerCall: 4
      maxImageBytes: 10485760
      maxImagePixels: 40000000
    cache:
      enabled: true
      maxEntries: 200
      ttlSeconds: 3600
    localProcessing:
      enabled: true
      maxWorkingPixels: 16000000
    localOcr:
      enabled: false
      languagePath: ""
      languages: [eng]
      gzip: true
      timeoutMs: 60000
      maxLanguageBytes: 52428800
      maxRegions: 50
      pageSegMode: auto
      autoRotate: true
      lowConfidenceThreshold: 40
    browserCapture:
      enabled: false
      browserChannel: msedge
      allowedHosts: []
      allowPrivateHosts: false
      viewportWidth: 1440
      viewportHeight: 900
      maxPageHeight: 12000
      navigationTimeoutMs: 30000
    timeoutMs: 120000
    proxyUrl: ""
```

使用 YAML 时，仍需在 Harness Credentials 中保存 `VISION_API_KEY`，不要把真实值写进 YAML。

启用后，在模型选择器里选择：

```text
DeepSeek + Vision Workbench / <配置的 DeepSeek 模型>
```

然后上传图片并正常提问。包装路由会让 DeepSeek 看到确定性的附件标记，模型可以调用：

```text
vision_describe attachment_ids=["sha256:..."] question="这张截图显示了什么？" structured=true
```

阶段 2 工具示例：

```text
vision_ocr attachment_id="sha256:..." language_hint="中文和英文"
vision_ocr attachment_id="sha256:..." backend="local"
vision_crop attachment_id="sha256:..." region={"x":100,"y":80,"width":600,"height":300}
vision_compare before={"attachment_id":"sha256:before"} after={"attachment_id":"sha256:after"} tolerance=0.02
vision_palette path="screenshots/home.png" count=6
```

`vision_crop` 和 `vision_compare` 返回的图片会先通过 `ctx.attachments.saveImage()` 保存，再作为工具结果中的图片块进入会话。后续可以直接把新附件 ID 交给 `vision_describe` 或 `vision_ocr`。

## 阶段 3 网页截图闭环

网页截图是第二层显式开关。先只加入确实需要访问的精确主机名，不要写协议、端口、路径或通配符：

```yaml
browserCapture:
  enabled: true
  browserChannel: msedge
  allowedHosts:
    - example.com
    - cdn.example.com
  allowPrivateHosts: false
  viewportWidth: 1440
  viewportHeight: 900
  maxPageHeight: 12000
  navigationTimeoutMs: 30000
```

随后可以组成有界开发闭环：

```text
vision_browser_capture url="https://example.com" full_page=true wait_after_load_ms=500
vision_describe attachment_ids=["sha256:..."] question="检查页面布局和可见错误" structured=true
vision_compare before={"attachment_id":"sha256:before"} after={"attachment_id":"sha256:after"}
```

每次调用只启动本机已安装的 Edge（默认）或 Chrome，无需执行 `playwright install`，也不会下载 Chromium。浏览器使用非持久临时上下文，Service Worker 被关闭，下载被禁止，弹窗被自动取消；浏览器及其上下文会在成功、失败、中止或插件卸载时关闭。页面引用的外部 CDN 若未列入白名单会被阻断并计入 `blockedRequests`。

若确实要截图本机开发服务器，必须同时将 `127.0.0.1` 加入 `allowedHosts` 并把 `allowPrivateHosts` 改为 `true`。这会扩大 SSRF/本机服务访问面，只建议用于可信项目的隔离 Profile。

## 阶段 4 多 Provider 回退

主 Provider 保持在 `visionProvider`，后备 Provider 按 `fallbackProviders` 数组顺序尝试，最多三个。每个 `name` 必须唯一，因为该名称会进入持久工具结果和安全错误摘要：

```yaml
visionProvider:
  name: primary
  baseURL: https://vision-a.example/v1
  model: vision-a
  credentialRef: VISION_A_KEY
  allowKeyless: false
  allowInsecureLocalhost: false
  maxTokens: 4096
fallbackProviders:
  - name: backup
    baseURL: https://vision-b.example/v1
    model: vision-b
    credentialRef: VISION_B_KEY
    allowKeyless: false
    allowInsecureLocalhost: false
    maxTokens: 4096
providerRouting:
  attemptTimeoutMs: 45000
  failureThreshold: 2
  cooldownSeconds: 60
```

路由只执行顺序、有限回退，不并发发送图片。某 Provider 连续失败达到 `failureThreshold` 后会在进程内短路 `cooldownSeconds`；冷却结束后自动探测恢复。用户取消会立即停止，不会继续向后备端点发送图片。所有 Provider 共用整次工具调用的 `timeoutMs`，所以总超时应大于单次 `attemptTimeoutMs`，才能为后备调用留下时间。

成功结果会记录 `provider`、`model`、`providerAttempts` 和 `fallbackUsed`，分别表示实际成功端点、实际模型、本次尝试过的 Provider 数量，以及是否由非主 Provider 完成。单个 Provider 内部的一次 429 重试仍算一个 Provider 尝试。

## 阶段 5 离线 OCR

本地 OCR 是独立、显式的隐私边界。将可信来源的 Tesseract `.traineddata.gz` 文件放进一个本地目录，并在隔离 Profile 中启用：

```yaml
localOcr:
  enabled: true
  languagePath: 'D:\vision-data\tesseract'
  languages: [eng, chi_sim]
  gzip: true
  timeoutMs: 60000
  maxLanguageBytes: 52428800
  maxRegions: 50
  pageSegMode: auto
  autoRotate: true
  lowConfidenceThreshold: 40
```

目录中必须存在与配置完全对应的文件，例如 `eng.traineddata.gz` 和 `chi_sim.traineddata.gz`。建议先核对发布方与 SHA-256，再复制到固定只读目录。若使用未压缩文件，将 `gzip` 设为 `false`，文件名改为 `.traineddata`。

```text
vision_ocr path="screenshots/settings.png" backend="local"
```

本地模式不使用 `visionProvider`、不会访问 CDN、不会写 Tesseract 缓存，也不会在失败后静默切换远程 Provider。结果中的 `backend` 为 `local`，`provider` 为 `local-tesseract`，并附带页级 `confidence`。`languages` 决定实际识别数据；`language_hint` 只用于远程 Provider。

一个插件实例只创建一个惰性 Worker，多次识别按顺序复用，以限制 Windows 上的内存峰值。超时、取消和插件卸载都会终止 Worker；下一次调用才会重新创建。

## 阶段 2 本地后端

Sharp 0.35.3 是可选生产依赖，官方提供 Windows x64 和 ARM64 预编译包。插件只在调用本地工具时动态加载它，不修改全局 Sharp 缓存、并发度或 libvips 设置。

- 安装器必须允许 optional dependencies；否则三个本地工具会给出明确的后端不可用错误。
- 本地操作同时受输入字节、输入像素和 `localProcessing.maxWorkingPixels` 限制。
- 当前像素比较要求两张图片尺寸完全相同，避免自动缩放掩盖真实布局差异。
- OCR 默认使用远程视觉 Provider；只有显式 `backend="local"` 才进入离线路径。本地路径从不隐式下载语言包，远程路径只有在工具真正执行时才发送所选图片。
- Tesseract.js 7.0.0 是惰性加载的可选生产依赖；本地 OCR 语言数据由用户独立管理，不进入插件 tarball。

## 本地开发

安装依赖前应先审查锁文件。阶段 2 的 Sharp 使用平台预编译可选包；不需要本机 Visual Studio/C++ 编译器时，不应允许退回源码构建。阶段 3 的 `playwright-core` 不携带或下载浏览器，直接控制本机已有的稳定版 Edge/Chrome。

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run smoke:local-ocr
```

首次生成锁文件时使用 `pnpm install`，提交并审查锁文件后再使用 `--frozen-lockfile`。

### Windows 路径注意事项

当前 rc.5 的 `dsh plugin` 在 Windows 上会通过 shell 转发 pnpm 参数；本地插件或 tarball 路径含空格时，路径可能被错误拆分。
本项目目录本身含空格，因此验证时先把 tarball 复制到无空格的临时路径，再执行 `dsh plugin --profile <name> add <tarball>`。
这是 Harness CLI 的上游限制，不是本插件对图片路径的限制；安装完成后，工作区图片路径仍通过 `ctx.fs` 正常处理。

## 已知限制

- 工作区文件只做有界格式和尺寸头检查；上传附件的完整解码验证由 Harness `ctx.attachments` 保证。
- 视觉 Provider 必须兼容 OpenAI `/chat/completions` 的 `image_url` 内容格式。
- 最多配置三个后备 Provider；当前只做固定顺序回退，不做成本、延迟或质量评分路由。
- 熔断状态是进程内临时状态，插件重载或进程重启后会清零；它不是跨节点健康检查系统。
- 包装路由只公布配置中的一个文本模型；修改模型或路由需要重载插件。
- 可视化配置保存后需要重启当前 Profile；这是明确的资源生命周期边界，不是保存失败。
- 图片标记是持久附件引用的确定性投影，不包含未记录的视觉结论；真正视觉结论只通过持久工具结果进入会话。
- Provider OCR 区域框来自视觉模型，本地 OCR 区域框来自 Tesseract 文本块；两者都属于近似证据，需要像素级操作前应先核对或显式指定裁剪坐标。
- 本地 OCR 不理解界面语义，复杂表格、手写字、低对比度或旋转截图的质量可能明显低于多模态视觉模型；`confidence` 只能用于提示复核，不能当作正确性保证。
- 调色板使用缩小采样与 5-bit RGB 量化，适合界面主色判断，不是色彩管理或印刷取色工具。
- 网页截图是视觉证据而不是 DOM 自动化；当前没有元素选择器、点击、键盘、登录、可访问性树或 PDF 导出。
- 精确白名单可能阻断第三方字体、图片或脚本；根据 `blockedRequests` 审查后逐个加入所需主机。
- 公司 Edge/Chrome 策略可能阻止 Playwright 启动；此时应切换已安装的另一浏览器通道或由管理员调整策略，而不是关闭网络边界。
