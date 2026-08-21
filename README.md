# 味千拉面 · 线上舆情工作台（后端鉴权版）

自带后端的工作台：**每 15 分钟自动抓取一次舆情 → 入库 → 前端展示**，并带
**账号注册 → 主管理员审批 → 登录查看** 的权限体系。零第三方依赖，单进程即可运行。

> ⚠️ 合规提醒：小红书 / 大众点评 反爬极强且有诉讼先例，抖音次之，微博相对松。
> 当前 `scrapers.js` 内为「合成兜底数据」，仅用于跑通全链路。**正式上线前请确认数据来源合规**
> （建议：自爬接受风险，或改用 licensed 舆情服务 清博/识微/鹰眼 的 API 再 webhook 进来）。

---

## 本地运行

```bash
cd yuqing-backend
node server.js
# 默认 http://localhost:3000
```

首次启动会自动创建主管理员：
- 账号：`admin` / 密码：`admin123`
- 请尽快通过环境变量 `ADMIN_USER` / `ADMIN_PASS` 改成你自己的，或登录后自行管理

打开浏览器访问 `http://localhost:3000` → 用 admin 登录 → 在「审批」里通过其他人注册申请。

## 角色权限（主管理员在「用户管理」里分配）

| 角色 | 能做什么 |
|---|---|
| `admin` 主管理员 | 一切权限：审批注册、分配角色、导入/导出、处理预警 |
| `editor` 编辑 | 查看 + 标记预警已处理 / 转跟进（适合运营同事） |
| `viewer` 只读 | 仅查看，不能任何操作（适合老板/外部看客） |

> 注册默认是「只读」，由主管理员在「用户管理」里按需提升为「编辑」。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `JWT_SECRET` | `change-this-secret-in-prod` | 登录令牌签名密钥，**生产必须改** |
| `ADMIN_USER` | `admin` | 主管理员账号 |
| `ADMIN_PASS` | `admin123` | 主管理员密码 |
| `SCRAPE_INTERVAL_MIN` | `15` | 爬虫间隔（分钟） |
| `MONITOR_KEYWORDS` | `味千拉面` | 监测关键词，逗号分隔，如 `味千拉面,味千儿童节套餐`（第一个词作为「本品」用于竞品对比与微博抓取） |
| `COMPETITORS` | `和府捞面,遇见小面,李先生牛肉面大王,马记永,陈香贵,老碗会` | 竞品对比品牌（均为门店≥300家的面条类连锁），逗号分隔，最多 6 个 |
| `NEG_WORDS` | `难吃,差评,投诉,恶心,维权,欺骗,过期,卫生,坑,假` | 命中即算负面/危机并标红进预警，逗号分隔 |
| `WEIBO_COOKIE` | 空 | 微博登录 cookie，填了抓取更稳定（真实抓取已默认开启） |

## PaaS 一键部署（Railway / Render / 类似平台）

1. 把整个 `yuqing-backend/` 目录推到你的 Git 仓库（或上传）。
2. 在 Railway / Render 新建 **Web Service**，构建命令留空（无需 build），启动命令 `node server.js`。
3. 设置环境变量：`JWT_SECRET`、`ADMIN_PASS`（务必改）、`PORT` 按平台要求（Railway 用 `$PORT`，Render 自动注入）。
4. 部署完成后，平台会给你一个公网域名，直接访问即可登录。
5. 数据库就是项目内的 `data/db.json`（Railway/Render 的临时磁盘可能随重启清空，正式可用请挂持久卷或改 `store.js` 接 SQLite/Postgres）。

## 如何接入真实抓取

编辑 `scrapers.js` 里的 `adapter(platform)` 函数，按平台返回：

```js
function adapter(platform){
  // 在此实现 platform 的真实抓取，返回：
  return {
    volume: 12345,            // 该平台当日声量
    negVolume: 1234,          // 负面声量
    alerts: [{ summary, sentiment, severity }],  // 预警/危机
    hotlist: [{ title, volume, engagement, sentiment }] // 热点爆文
  };
}
```

- 小红书 / 抖音：需登录态 + 签名（x-s/x-t）+ 代理 IP 池
- 大众点评：强烈建议走 licensed 舆情服务，再 `POST /api/import` 入库
- 微博：公开 search 接口较易，需 cookie 与频控

改完无需改前端，调度器每 15 分钟自动调用并刷新页面。

## 接口一览（前端已封装）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | 注册（状态=待审批） |
| POST | `/api/login` | 登录，返回 JWT |
| GET | `/api/me` | 当前用户 |
| GET | `/api/admin/pending` | 待审批列表（管理员） |
| POST | `/api/admin/approve` | 审批通过（管理员） |
| GET | `/api/admin/users` | 用户列表含角色（管理员） |
| POST | `/api/admin/setrole` | 设置用户角色 editor/viewer（管理员） |
| GET | `/api/data` | 舆情数据 |
| POST | `/api/alert/:id/done` | 标记预警已处理 |
| GET | `/api/export` | 导出 JSON |
| POST | `/api/import` | 导入 JSON（管理员） |
