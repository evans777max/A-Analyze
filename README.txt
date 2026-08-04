流金科技实时看盘｜腾讯 EdgeOne Makers（原 EdgeOne Pages）直接上传包

推荐部署方式：Direct Upload / 直接上传

1. 打开 https://pages.edgeone.ai/ 并登录。
2. 进入控制台，选择 Create Project / 创建项目。
3. 选择 Direct Upload / 直接上传，不要选择模板。
4. 项目名称可填写：liujin-live。
5. 加速区域先选择 Global / 全球（无需自定义域名备案即可测试）。
6. 解压本ZIP，将 edgeone-liujin 文件夹内的 index.html 拖入上传区域。
7. 点击 Start Deployment / 开始部署。
8. 部署完成后打开系统生成的 edgeone.app 预览网址。

重要说明：
- 上传的是解压后的 index.html，不是ZIP本身。
- 该页面无构建命令、无输出目录、无环境变量。
- 页面每10秒调用腾讯行情接口刷新流金科技与北证50数据。
- 不依赖ChatGPT、数据库或Edge Functions。
- 不包含持仓、成本或账户信息。
- 页面信息仅供研究与交流，不构成投资建议。

后续更新：
- 修改 index.html 后，在项目控制台重新上传并部署。
- 如果以后需要GitHub自动部署，应新建一个Git集成项目；官方说明直接上传项目不能原地切换为Git集成。
