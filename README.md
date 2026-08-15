# DSH Vision Suite

面向 Windows 的 DeepSeek Harness 视觉能力套件，插件包名为 <code>dsh-vision-workbench</code>。它在保留官方 <code>deepseek-official</code> 文本路由的同时，为 DeepSeek 增加图片理解、OCR、截图裁剪、像素差异比较、主色提取和安全网页截图能力。

DeepSeek 继续负责推理。只有调用远程视觉工具时，插件才会把用户选定的图片发送给已配置的 OpenAI-compatible 视觉模型。

## 插件能力

| 工具 | 作用 | 执行位置 |
| --- | --- | --- |
| <code>vision_describe</code> | 理解 1～4 张上传图片或工作区图片，支持图片问答、多图比较和结构化截图证据 | 视觉 Provider |
| <code>vision_ocr</code> | 识别整张图片或指定区域中的文字，可选择远程视觉模型或本地 Tesseract | Provider 或本机 |
| <code>vision_crop</code> | 按像素坐标裁剪图片，并保存为可继续使用的持久附件 | 本机 |
| <code>vision_compare</code> | 比较两张同尺寸截图，返回变化比例和洋红色差异图 | 本机 |
| <code>vision_palette</code> | 提取图片中的近似主色 | 本机 |
| <code>vision_browser_capture</code> | 使用独立的无头 Edge 或 Chrome 截取白名单网页 | 本机浏览器 |

插件还提供：

- 支持 PNG、JPEG 和 WebP。
- 图片附件使用持久 ID，工具结果可随会话保存和回放。
- 支持一个主视觉 Provider 和最多三个顺序后备 Provider。
- Provider 失败时执行有限回退，并通过冷却机制避免持续请求故障端点。
- 支持图片数量、文件大小、像素数、工作像素、超时和缓存限制。
- API Key 通过 Harness Credentials 保存，不写入插件配置、日志或页面响应。
- 可为插件请求单独配置 HTTP/HTTPS 代理，不修改全局网络设置。
- Sharp、Tesseract.js 和浏览器能力均按需加载。

## 配置入口

插件安装后默认保持关闭，不会自动接管模型路由，也不会自动发送图片。

推荐使用 DeepSeek Harness 原生配置页面：

1. 启动安装了本插件的 Web Profile。
2. 打开“设置 → 插件 → 插件配置”。
3. 点击 <code>Vision Workbench</code> 展开全部配置项。
4. 填写文本模型、视觉 Provider 和 API Key。
5. 打开“启用插件”，保存配置。
6. 重启当前 Profile，使路由和工具配置生效。

API Key 密码框为空时会保留已经保存的密钥。页面刷新后不会回显密钥，只会显示对应凭据是否已经配置。

## API Key 官方入口

下面这些服务都提供官方 API Key，并有可通过 OpenAI-compatible Chat Completions 接收图片的模型。实际可用模型、额度和区域限制可能变化，请以服务商官网当前信息为准。

| 服务商 | <code>baseURL</code> | API Key 官网 | 视觉兼容说明 |
| --- | --- | --- | --- |
| OpenAI | <code>https://api.openai.com/v1</code> | [创建 API Key](https://platform.openai.com/api-keys) | [查看支持 Image input 和 Chat Completions 的模型](https://developers.openai.com/api/docs/models/compare) |
| OpenRouter | <code>https://openrouter.ai/api/v1</code> | [创建或管理 API Key](https://openrouter.ai/settings/keys) | [Image Inputs 官方文档](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding) |
| 硅基流动 SiliconFlow | <code>https://api.siliconflow.cn/v1</code> | [创建或管理 API Key](https://cloud.siliconflow.cn/account/ak) | [多模态输入官方文档](https://api-docs.siliconflow.cn/docs/userguide/capabilities/multimodal-vision) |
| 阿里云百炼 | 中国大陆：<code>https://dashscope.aliyuncs.com/compatible-mode/v1</code><br>国际：<code>https://dashscope-intl.aliyuncs.com/compatible-mode/v1</code> | [获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key/) | [OpenAI 兼容 Chat 与图片输入](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |

在插件中配置时：

1. 把表格中的地址填入 <code>visionProvider.baseURL</code>。
2. 从服务商官网复制一个支持图片输入的模型 ID，填入 <code>visionProvider.model</code>。
3. 为该服务设置独立的 <code>credentialRef</code>，例如 <code>OPENAI_VISION_KEY</code> 或 <code>OPENROUTER_VISION_KEY</code>。
4. 把真实 API Key 粘贴到对应 Provider 卡片的密码框中，不要写入 YAML、截图、Issue 或日志。

同一个服务商可能同时提供纯文本模型和视觉模型。选择模型时必须确认它支持 <code>image_url</code> 图片输入以及 <code>/chat/completions</code> 接口。

## 最小可用配置

第一次使用只需要配置以下内容：

| 配置项 | 推荐值或说明 |
| --- | --- |
| <code>enabled</code> | 开启 |
| <code>wrapperRoute</code> | 保持 <code>deepseek-vision-workbench</code> |
| <code>textProvider.provider</code> | 保持 <code>deepseek-official</code> |
| <code>textProvider.model</code> | 选择当前 Harness 中可用的 DeepSeek 模型 |
| <code>visionProvider.name</code> | <code>primary</code> |
| <code>visionProvider.baseURL</code> | 视觉服务的 OpenAI-compatible API 地址，例如 <code>https://api.example.com/v1</code> |
| <code>visionProvider.model</code> | 服务商提供的视觉模型名称 |
| <code>visionProvider.credentialRef</code> | 凭据名称，例如 <code>VISION_API_KEY</code> |
| API Key | 在同一 Provider 卡片的密码框中输入 |

保存并重启 Profile 后，在模型选择器中选择：

~~~text
DeepSeek + Vision Workbench / <配置的 DeepSeek 模型>
~~~

随后上传图片并直接提问，例如“识别这张截图中的文字”或“比较这两张图片的布局差异”。

## 基础配置

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>enabled</code> | <code>false</code> | 是否注册包装路由和视觉工具 |
| <code>wrapperRoute</code> | <code>deepseek-vision-workbench</code> | 插件自己的模型路由名称，不能与 <code>deepseek-official</code> 或文本 Provider 重名 |
| <code>textProvider.provider</code> | <code>deepseek-official</code> | 负责最终推理的文本 Provider |
| <code>textProvider.model</code> | <code>deepseek-v4-pro</code> | 包装路由公布的文本模型 |
| <code>timeoutMs</code> | <code>120000</code> | 一次视觉工具调用的总超时 |
| <code>proxyUrl</code> | 空 | 仅用于本插件请求的 HTTP/HTTPS 代理 |

## 视觉 Provider

主 Provider 位于 <code>visionProvider</code>，后备 Provider 位于 <code>fallbackProviders</code>。

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>name</code> | <code>primary</code> | Provider 标识；主备 Provider 之间不能重名 |
| <code>baseURL</code> | 空 | OpenAI-compatible API 根地址，正常使用必须是 HTTPS |
| <code>model</code> | 空 | 视觉模型名称 |
| <code>credentialRef</code> | <code>VISION_API_KEY</code> | Harness Credentials 中的凭据名称 |
| <code>allowKeyless</code> | <code>false</code> | 仅在服务明确不需要密钥时开启 |
| <code>allowInsecureLocalhost</code> | <code>false</code> | 仅允许显式连接本机回环地址上的 HTTP 测试服务 |
| <code>maxTokens</code> | <code>4096</code> | 视觉模型最大输出 Token 数 |

<code>baseURL</code> 中不能嵌入用户名、密码或 API Key。远程服务必须兼容 OpenAI <code>/chat/completions</code> 的 <code>image_url</code> 内容格式。

### Provider 回退

最多可以配置三个后备 Provider，插件会按照列表顺序逐个尝试，不会并发把图片发送给多个端点。

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>providerRouting.attemptTimeoutMs</code> | <code>45000</code> | 单个 Provider 的尝试超时 |
| <code>providerRouting.failureThreshold</code> | <code>2</code> | 连续失败多少次后进入冷却 |
| <code>providerRouting.cooldownSeconds</code> | <code>60</code> | 故障 Provider 的冷却时间 |

总超时 <code>timeoutMs</code> 应大于单次超时 <code>attemptTimeoutMs</code>，否则可能没有足够时间尝试后备 Provider。

## 图片限制与缓存

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>limits.maxImagesPerCall</code> | <code>4</code> | 单次视觉调用最多处理的图片数 |
| <code>limits.maxImageBytes</code> | <code>10485760</code> | 单张图片最大字节数，默认 10 MiB |
| <code>limits.maxImagePixels</code> | <code>40000000</code> | 单张图片最大像素数 |
| <code>cache.enabled</code> | <code>true</code> | 是否缓存视觉结果 |
| <code>cache.maxEntries</code> | <code>200</code> | 最大缓存条目数 |
| <code>cache.ttlSeconds</code> | <code>3600</code> | 缓存有效时间；设为 0 表示不按时间过期 |

## 本地图片处理

本地裁剪、截图比较和调色板提取依赖可选的 Sharp 后端。

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>localProcessing.enabled</code> | <code>true</code> | 是否启用本地像素工具 |
| <code>localProcessing.maxWorkingPixels</code> | <code>16000000</code> | 本地处理过程允许的最大工作像素数 |

<code>vision_compare</code> 要求两张截图尺寸完全相同。插件不会自动缩放或对齐图片，以免掩盖真实布局变化。

## 本地 OCR

<code>vision_ocr</code> 默认使用远程视觉 Provider。只有明确选择 <code>backend="local"</code> 时，才会进入本地 Tesseract OCR。

开启本地 OCR 前，需要自行准备可信来源的 Tesseract 语言数据文件：

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>localOcr.enabled</code> | <code>false</code> | 是否允许本地 OCR |
| <code>localOcr.languagePath</code> | 空 | 语言文件所在的绝对本地目录 |
| <code>localOcr.languages</code> | <code>eng</code> | 1～4 个语言代码，例如 <code>eng</code>、<code>chi_sim</code> |
| <code>localOcr.gzip</code> | <code>true</code> | 是否使用 <code>.traineddata.gz</code> 文件 |
| <code>localOcr.timeoutMs</code> | <code>60000</code> | 单次本地识别超时 |
| <code>localOcr.maxLanguageBytes</code> | <code>52428800</code> | 单个语言文件最大字节数 |
| <code>localOcr.maxRegions</code> | <code>50</code> | 最多返回的文字区域数 |
| <code>localOcr.pageSegMode</code> | <code>auto</code> | 页面分割模式：<code>auto</code>、<code>single-block</code> 或 <code>sparse-text</code> |
| <code>localOcr.autoRotate</code> | <code>true</code> | 是否自动处理方向 |
| <code>localOcr.lowConfidenceThreshold</code> | <code>40</code> | 低置信度提示阈值 |

Windows 配置示例：

~~~yaml
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
~~~

目录中应存在 <code>eng.traineddata.gz</code>、<code>chi_sim.traineddata.gz</code> 等与配置一致的文件。本地 OCR 不会自动下载语言包、访问 CDN、写入 Tesseract 缓存，也不会在失败后自动切换到远程 Provider。

## 网页截图

网页截图默认关闭。开启后必须填写精确的主机白名单：

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| <code>browserCapture.enabled</code> | <code>false</code> | 是否注册网页截图工具 |
| <code>browserCapture.browserChannel</code> | <code>msedge</code> | 使用 <code>msedge</code> 或 <code>chrome</code> |
| <code>browserCapture.allowedHosts</code> | 空 | 允许访问的精确主机名列表 |
| <code>browserCapture.allowPrivateHosts</code> | <code>false</code> | 是否允许访问本机或私有网络地址 |
| <code>browserCapture.viewportWidth</code> | <code>1440</code> | 浏览器视口宽度 |
| <code>browserCapture.viewportHeight</code> | <code>900</code> | 浏览器视口高度 |
| <code>browserCapture.maxPageHeight</code> | <code>12000</code> | 全页截图的最大页面高度 |
| <code>browserCapture.navigationTimeoutMs</code> | <code>30000</code> | 页面导航超时 |

白名单只填写主机名，不要包含协议、端口、路径或通配符：

~~~yaml
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
~~~

插件每次都会创建新的非持久浏览器上下文，不复用用户登录态。下载、弹窗和 Service Worker 会被禁用；导航、重定向、子资源及 WebSocket 都受同一白名单约束。

如需截图本机开发服务，必须把 <code>127.0.0.1</code> 加入 <code>allowedHosts</code>，并开启 <code>allowPrivateHosts</code>。这会扩大本机网络访问范围，只建议在可信的隔离 Profile 中使用。

## YAML 配置示例

没有 Web 配置界面时，可以在 Profile 的后置 Patch 中使用：

~~~yaml
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
~~~

API Key 不应直接写入 YAML。请在 Harness Credentials 或插件可视化配置卡片中，把真实密钥保存到 <code>credentialRef</code> 指定的名称。

## 使用示例

上传图片后可以直接向所选的包装模型提问。模型可根据任务调用：

~~~text
vision_describe attachment_ids=["sha256:..."] question="这张截图显示了什么？" structured=true
vision_ocr attachment_id="sha256:..." language_hint="中文和英文"
vision_ocr attachment_id="sha256:..." backend="local"
vision_crop attachment_id="sha256:..." region={"x":100,"y":80,"width":600,"height":300}
vision_compare before={"attachment_id":"sha256:before"} after={"attachment_id":"sha256:after"} tolerance=0.02
vision_palette path="screenshots/home.png" count=6
vision_browser_capture url="https://example.com" full_page=true wait_after_load_ms=500
~~~

裁剪图、差异图和网页截图都会保存为持久附件，可继续交给 <code>vision_describe</code>、<code>vision_ocr</code> 或后续会话步骤使用。

## 能力边界

- 不禁用或替换 <code>deepseek-official</code>。
- 不内置匿名视觉服务，不会在没有配置 Provider 时发送图片。
- 不支持 GIF；请先转换为 PNG、JPEG 或 WebP。
- 不捆绑或自动下载 Tesseract 语言数据。
- 不接管用户已经打开的浏览器，不复用登录态，也不执行网页点击、输入或表单提交。
- 网页截图提供视觉证据，不提供 DOM 自动化、登录或 PDF 导出。
- 本地 OCR 对复杂表格、手写字、低对比度或旋转截图的效果可能低于多模态视觉模型。
- 调色板适合界面主色判断，不适合作为色彩管理或印刷取色工具。
