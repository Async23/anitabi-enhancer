# 开发与验证

扩展使用 Manifest V3 和原生 JavaScript，无运行时依赖，也无需编译。直接加载 `extension/` 即可运行。

## 文件职责

- `extension/content.js`：在页面执行环境中读取作品数据，给原图标添加名称、悬停提示和键盘操作；计算顶部或左侧布局，并处理浏览按钮与滚轮。
- `extension/region.js`：控制区域作品列表的手动显隐，在远景或原生列表无可用内容时补充列表；按点位 ID 去重统计，处理加载、空结果、失败和数量上限，并同步已选作品数量。
- `extension/settings.js`：在扩展隔离环境中读取本地设置，通过限定的 DOM 属性向页面传递显示偏好；支持重复注入时重新连接设置监听并返回同步结果。
- `extension/content.css`：仅修改作品栏，限定扩展自身的类名与属性。
- `extension/page-settings.js`：地图内的设置面板与标记菜单，两个浮层互斥，标记开关只修改当前页面属性；在隔离环境中读写展示偏好；使用 Shadow DOM 隔离网站样式，一键切换名称、位置和语言；列表关闭时显示已筛选数量及清除入口。
- `extension/map-dots.js`：在页面环境中临时控制 `bangumi-point` 圆点图层的可见性，保留作品符号、底图与筛选；通过 DOM 属性接收当前页面的临时状态。
- `extension/map-symbols.js`：分别控制地图作品符号中的头像与文字，保存并恢复原生内容表达式，不影响作品列表。
- `extension/sync.js`：设置重连流程，恢复设置脚本、标记控制及页面入口，并支持直接打开页面面板。
- `extension/background.js`：扩展安装、更新或重新加载后恢复设置入口；切换到地图标签页时重连。工具栏点击打开同一页面面板，在其他网页点击时复用当前窗口的地图，没有地图则新建；等待加载的请求放在会话存储中。
- `assets/anitabi-favicon.ico`：Anitabi 网站原始图标；`extension/icons/` 保存工具栏及扩展管理页使用的多尺寸 PNG。
- `tests/`：在独立的无界面 Chromium 中实际加载扩展，验证页面脚本和设置交互。

## 命令

```sh
npm ci
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
npm run check
npm test
npm run test:live
npm run test:live:works
npm run test:live:settings
npm run build
```

GitHub 的 `Check extension` 工作流在推送和拉取请求时运行检查、浏览器测试与打包。Chrome 商店文案和审核复现步骤见[商店材料](../store/listing.zh-CN.md)。运行 `npm run store:screenshots` 在独立浏览器中重新生成商店截图；如果测试浏览器网络受限，可加 `ANITABI_HTTP_TRANSPORT=curl`。安装包同时附带项目 LICENSE 和第三方素材 NOTICE。

浏览器测试使用项目自己的 Chromium 和临时用户目录。不会连接日常使用的 Chrome 会话。

图标来自 [Anitabi 网站 favicon](https://www.anitabi.cn/favicon.ico)，于 2026-10-16 获取，原始尺寸为 16×16。保留其像素造型、配色和透明背景，使用最近邻缩放生成其他尺寸。原始 ICO 的 SHA-256 为 `36b8c7c63a04b7265ebee24f9c492c741da5ad212d66b6b131fe202e58131b39`。图标权利归原权利人，扩展仍为非官方项目。

修改图标后运行 `npm run icons` 重新生成 PNG，需要本机安装 ImageMagick（`magick`）。日常检查和打包直接使用已保存的 PNG，不依赖该工具。`npm run check` 核对图标格式、像素尺寸及清单引用；打包会递归包含图标目录。

`npm test` 使用根据网站 DOM 结构制作的本地测试页面，覆盖作品切换、节点复用、异步数据、筛选、设置持久化及布局；布局与滚动测试包含顶部和左侧切换、跟随缩略图高度、窄窗口回退、完整显示末尾作品、滚动条留白、圆角方形头像，以及滚轮在作品栏边界不传给地图。`npm run test:live` 访问真实网站，需要联网；核对网走作品名称与筛选、小樽横向浏览和头像形状，以及札幌左侧布局和位置切换，输出截图和核对结果到 `artifacts/`。

设置同步回归测试通过 Chromium 的扩展管理接口真正重新加载扩展，保留原地图，检查布局、紧凑模式、语言和列表开关；覆盖多个地图同步、保存失败恢复和重复打开面板后筛选、键盘事件不受影响。

`npm test -- tests/page-settings.spec.js tests/map-dots.spec.js` 覆盖页面设置、展示偏好持久化、事件隔离、焦点恢复、窄屏和矮窗口、网站范围、扩展重载，以及三类标记的八种显示组合、图层重建、原生内容更新、临时状态不跨页面且刷新重置。还覆盖地点缩略图独立隐藏、左侧列表补位、原生隐藏状态、节点重建和扩展重载。覆盖菜单键盘操作、关闭后的焦点、与作品设置互斥；旧主题偏好不再生效，明暗自动跟随系统。工具栏用独立 Chromium 的 `Extensions.triggerAction` 触发真实浏览器扩展动作，验证没有额外弹窗、复用已有地图和新建地图后打开面板。

`npm run test:live:settings` 在真实东京地图验证圆点隐藏与恢复、仅名称、仅头像、全部隐藏后无残留点击区域、地点缩略图显隐和左侧补位、原生控件对齐、拖动缩放、工具栏打开同一面板、自动跟随系统明暗、移除主题按钮、窄屏和扩展重载；截图及结果保存为 `artifacts/map-dots-*.png`、`artifacts/map-controls.png`、`artifacts/map-markers-*.png`、`artifacts/map-thumbnails-*.png`、`artifacts/page-settings-*.png`、`artifacts/page-settings-live-check.json`。

`tests/work-list.spec.js` 覆盖默认开启、0–22 缩放下开关状态不变、原生与补充列表交接、关闭后停止统计、重新开启使用新范围、重复点位去重、加载与空状态、读取失败、筛选提示、清除筛选、详情页、数量上限、超过 20 部的已选作品、扩展重载和刷新默认行为。旧阈值仅保留迁移测试，不再参与显示判断。

`npm run test:live:works` 在真实札幌 9.8 级视野验证默认开启，用完整作品记录独立核对当次点位数量，再验证跨 12 级保留开关和筛选、隐藏后清除筛选、刷新后恢复显示。结果保存为 `artifacts/work-list-live-check.json`，截图包括 `work-list-menu.png`、`work-list-hidden-selection.png` 和 `settings-work-list.png`。

如果新下载的测试浏览器无法联网、而本机 `curl` 可以访问网站，可在任一 `test:live` 命令前设置 `ANITABI_HTTP_TRANSPORT=curl`，例如 `ANITABI_HTTP_TRANSPORT=curl npm run test:live:settings`。该测试选项通过 curl 获取网站资源，再交给 Chromium 执行和显示，不改变防火墙设置，也不随扩展发布。

## 适配边界

重新加载扩展会使旧页面隔离环境中的设置监听失效，页面环境中的作品栏仍可能继续显示。因此后台在 `runtime.onInstalled`、`tabs.onActivated` 时重连地图，工具栏点击时也会重连并打开面板。先执行 `settings.js` 等待读取存储和应用属性，再注入可重复执行的 `region.js`、`map-dots.js`、`map-symbols.js` 与 `page-settings.js`；这些控制器均可重复注入。`content.js` 保留原实例，保留卡片筛选和原有事件。读取期间的新设置优先于旧快照。同一标签页的重连请求按顺序执行，避免切换标签与点击工具栏同时发生时互相清理设置监听。

页面入口在有效扩展环境内重复注入时复用已有控件；环境失效后用清理事件释放旧观察器和处理器，并恢复展开状态。作品栏偏好统一写入 `chrome.storage.local`，根元素属性驱动页面同步。主题不再读取或保存手动选择，`data-ae-theme` 固定为 `system`，兼容旧页面已经加载的样式。入口使用与原生控件一致的方形样式，尺寸、间距和右边距跟随原生控件，窄屏或矮窗口避开搜索框，面板限制高度并可内部滚动。自动重连不刷新或切换标签页；只有用户点击工具栏图标时，才可能切换或新建地图标签页。

圆点开关使用 `data-ae-dots-hidden`，不写入设置存储。只匹配 `bangumi-point`、`circle`、`points` 这一图层标识、类型和数据源组合，改变 `visibility`，恢复时还原之前的值；不改筛选、颜色或点位数据，也不影响头像与名称的符号图层。监听样式变化，并绑定延迟初始化或替换后的地图；扩展重连复用同一控制器，刷新页面自然清除临时状态。隐藏期间临时添加一个过滤掉全部要素的 `ae-points-source` 图层，让点位数据源继续更新，区域作品计数与缩略图不会因图层隐藏而失效；该层不绘制也不能点击，恢复圆点时移除。

头像和作品名称分别使用 `data-ae-avatars-hidden`、`data-ae-names-hidden`。仅处理 `bangumis`、`symbol`、`bangumis` 这一组合的 `icon-image` 与 `text-field`；隐藏时内容置空，避免用透明度隐藏后留下不可见的点击区域，恢复时还原先前值。网站在隐藏期间更新原生内容时，记录新值供恢复。图层重建、地图延迟初始化或替换后重新应用临时状态。符号控制器与旧版圆点控制器独立，0.5.0 已打开页面可热注入新控制器，保留圆点状态。

地点缩略图使用 `data-ae-thumbnails-hidden`，同样仅对当前页面生效。`page-settings.js` 在页面 head 中注入限定 `.window-points-box` 的隐藏规则，控件清理时一起移除，扩展更新后可直接作用于已打开页面。恢复时仅解除扩展限制，不强制覆盖网站的缩放、详情页或空列表隐藏逻辑；作品栏已有的 `ResizeObserver` 会在缩略图显隐时重排左侧列表。

`scripting` 权限和四个 Anitabi 域名的 `host_permissions` 用于重连，没有所有网站或所有标签页的读取权限。未加载增强界面、无法访问、冻结或休眠的地图不会报告为同步成功。工具栏打开失败时显示「!」及重试提示；旧页面通过 `.ae-scroller` 或 `data-ae-ready` 识别。本次设置入口、区域列表和标记模块可热注入，其他作品栏代码更新仍需刷新页面。

名称来自 `window.mapApp.BangumiIds`，通过原图标图片路径匹配。对于临时 blob 图片，只在作品颜色在已加载数据中唯一时使用颜色匹配；无法确认时移除之前的名称，保留原图标。这样可避免网站复用图标节点时显示上一部作品。

DOM 变化使用节流合并处理。页面数据与图片分批到达时有限重试，后续变化仍会触发更新。扩展不替换网站原有节点的点击回调；补充列表调用 `mapApp.setSelectedBangumis`，由网站继续管理筛选和地址状态。

`data-ae-works-hidden` 是区域列表的页面临时状态，默认 `false`，不写入 `chrome.storage.local`。关闭时 CSS 隐藏原生与补充列表，控制器跳过区域统计，但继续同步 `data-ae-selection-count`，以便显示筛选提示。提示中的清除按钮发出 `ae-work-list-clear`，页面控制器调用原网站筛选方法；该动作不会重新打开列表。

开启时，12 级以上优先复用可用的原生列表；低于 12 级或原生列表无可用内容时，使用扩展补充列表。计数读取 `map.querySourceFeatures('points')`，沿用网站的视口与面板边距口径，按点位 ID 去重、按作品聚合；不依赖被隐藏或筛选后的可见图标。补充列表使用已知作品 ID 解析名称。最多默认展示 20 项，已选作品优先且不因上限丢失，加载、空结果或数据错误保持可见提示。

地图事件合并为 300 毫秒更新，监听 `idle`、`moveend`、`load`、`sourcedata` 和原生列表变化；移动过程中不重新聚合。单部作品详情页沿用原站布局。没有更改地图缩放值或地点缩略图门槛。

0.7.0 迁移会停止读取并移除本地 `minZoom`。已打开的旧页面以升级前实际列表可见性初始化开关，新页面默认开启；移除 `data-ae-min-zoom` 后，旧 MAIN 环境中的阈值控制器回到原站交接值，不再生成替代列表。新列表用 `data-ae-work-list` 标识，并通过独立的 `data-ae-work-list-suppressed` 控制原生列表，避免旧控制器清理时干扰。旧补充节点移除，当前控制器通过 `__aeWorkList` 保证重连不重复安装。根元素的 `ae-work-list-hidden` 类变化也会通知旧卡片增强器重新计算布局。

位置偏好保存在 `position` 设置中，默认 `top`，左侧为 `left`。左侧布局读取搜索栏、地点缩略图、公告及底部控件的位置，并通过 `ResizeObserver` 跟随尺寸变化；空间不足时只临时回退布局，不覆盖保存的偏好。两种布局共用原网站的作品节点，切换不会丢失筛选状态。

相关接口参考：[Chrome 内容脚本](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)、[Chrome 脚本注入](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[标签页与网站权限](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)。
